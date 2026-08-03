/**
 * GET /api/worker/scheduled
 *
 * Content calendar worker — runs on a daily cron schedule.
 * Finds all scheduled_content records due today or earlier with status="planned",
 * generates the content via the agent, saves to documents, and marks as completed.
 *
 * Secured with WORKER_SECRET header — set this env var and add it to the cron config.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAgent, getDepartmentDefaultAgent } from "@staffd/agents";
import { resolveDepartments } from "../../_lib/trial";
import { bridgingIndustryFor } from "../../_lib/industry";
import { computeRetrievalP95 } from "../../_lib/vault";
import { enqueue } from "../../_lib/vault/queue";
import { recomputeActiveUserVoiceProfiles } from "../../_lib/vault/voice";
import { pickModel, callGroq, computeCostUsd } from "../../_lib/llm-router";
import { planGoal } from "../../_lib/orchestrator/plan-goal";
import { materializePlan } from "../../_lib/workflow-materialize";
import { isRecurrence, nextRecurrenceDate } from "../../_lib/recurrence";
import { produceStudioVideo } from "../../_lib/montage/produce-core";
import { montageConfigured } from "../../_lib/integrations/montage/client";

const anthropic = new Anthropic();

async function getAdminToken(pbUrl: string): Promise<string> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error("Admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function generateContent(task: string, department: string, agentId: string | null, vault: Record<string, unknown> | null, activePacks: string[] = []): Promise<string> {
  // Single source of truth: packages/agents. Caller-supplied agent wins,
  // otherwise fall back to the department's canonical default.
  // W58.2 (D-19) — pack-aware default so a bridged restaurant user's
  // scheduled marketing post comes from the pack specialist, not generic.
  const resolvedAgent = (agentId ? getAgent(agentId) : null) ?? getDepartmentDefaultAgent(department, activePacks);
  let systemPrompt = resolvedAgent?.systemPrompt ?? "";

  if (vault) {
    const lines: string[] = [];
    if (vault.business_name) lines.push(`Business name: ${vault.business_name as string}`);
    if (vault.industry)      lines.push(`Industry: ${vault.industry as string}`);
    if (vault.description)   lines.push(`Description: ${vault.description as string}`);
    if (vault.target_audience) lines.push(`Target audience: ${vault.target_audience as string}`);
    if (lines.length > 0) {
      systemPrompt += `\n\n--- BUSINESS VAULT ---\n${lines.join("\n")}\n--- END VAULT ---`;
    }
  }

  // Phase 3 — same routing logic as /api/agent. Scheduled content tends to
  // be social posts / captions / short replies, so short-form routing fires
  // often here and the wedge is meaningful at cron volume.
  const choice = pickModel({ department, agentId: agentId ?? undefined, task });
  console.log(`[worker] model_choice provider=${choice.provider} model=${choice.model} dept=${department} reason="${choice.reason}"`);

  if (choice.provider === "groq") {
    const result = await callGroq(choice.model, systemPrompt, task, 8192);
    const cost = computeCostUsd(choice.model, result.tokensIn, result.tokensOut);
    console.log(`[worker] groq_cost model=${choice.model} in=${result.tokensIn} out=${result.tokensOut} cost_usd=${cost.toFixed(6)}`);
    return result.text;
  }

  const msg = await anthropic.messages.create({
    model: choice.model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: task }],
  });

  const tokensIn = msg.usage?.input_tokens ?? 0;
  const tokensOut = msg.usage?.output_tokens ?? 0;
  const cost = computeCostUsd(choice.model, tokensIn, tokensOut);
  console.log(`[worker] anthropic_cost model=${choice.model} in=${tokensIn} out=${tokensOut} cost_usd=${cost.toFixed(6)}`);

  const block = msg.content[0];
  return block?.type === "text" ? block.text : "";
}

export async function GET(req: Request) {
  // Security — Vercel sends CRON_SECRET as a Bearer token on cron invocations.
  // Also accepts x-worker-secret header for manual testing.
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";

  const validCron   = cronSecret   && authHeader === `Bearer ${cronSecret}`;
  const validManual = workerSecret && workerHeader === workerSecret;

  if (!validCron && !validManual) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "PocketBase not configured" }, { status: 503 });

  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    const token = await getAdminToken(pbUrl);
    const headers = { Authorization: token, "Content-Type": "application/json" };

    // Fetch all planned items due today or earlier
    const encoded = encodeURIComponent(`(status='planned'&&scheduled_date<='${todayKey}')`);
    const listRes = await fetch(
      `${pbUrl}/api/collections/scheduled_content/records?filter=${encoded}&perPage=50&sort=scheduled_date`,
      { headers: { Authorization: token } }
    );
    if (!listRes.ok) {
      return Response.json({ error: "Failed to fetch scheduled items" }, { status: 500 });
    }

    const listData = (await listRes.json()) as {
      items?: Array<{
        id: string;
        user: string;
        department: string;
        agent_name: string;
        task: string;
        scheduled_date: string;
        // PR-Loop-V4 (#8) — "content" (default) | "workflow_goal"
        kind?: string;
        // PR-Loop-V4 (#8) — "" | "weekly" | "monthly"
        recurrence?: string;
      }>;
    };

    const items = listData.items ?? [];
    if (items.length === 0) {
      return Response.json({ ok: true, processed: 0, message: "No items due" });
    }

    const results: Array<{ id: string; status: "completed" | "failed"; error?: string }> = [];

    // PR-Loop-V4 (#8) — after an item lands (either outcome), a recurring
    // item schedules its next occurrence. Cloned on failure too, so one
    // transient outage never kills a recurring schedule.
    const scheduleNext = async (item: { id: string; user: string; department: string; agent_name: string; task: string; scheduled_date: string; kind?: string; recurrence?: string }) => {
      if (!isRecurrence(item.recurrence)) return;
      try {
        await fetch(`${pbUrl}/api/collections/scheduled_content/records`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            user: item.user,
            department: item.department,
            agent_name: item.agent_name ?? "",
            task: item.task,
            scheduled_date: nextRecurrenceDate(item.scheduled_date, item.recurrence),
            status: "planned",
            kind: item.kind ?? "content",
            recurrence: item.recurrence,
          }),
        });
      } catch (err) {
        console.warn(`Worker: failed to schedule next recurrence for ${item.id}:`, err);
      }
    };

    for (const item of items) {
      // PR-Loop-V4 (#8) — recurring staff: a "workflow_goal" item runs the
      // SAME planner → critic → materialize pipeline as an interactive L4
      // ask, but always review-gated (HITL on anything outbound). The
      // per-minute drain then executes it; StaffWorkQueue holds the gate.
      // P3 — campaign runner: a scheduled video enters Studio production
      // on its calendar date. The webhook + render grader + bell handle
      // delivery; recurrence (if any) reschedules via scheduleNext below.
      if (item.kind === "video_production") {
        if (!montageConfigured()) {
          await fetch(`${pbUrl}/api/collections/scheduled_content/records/${item.id}`, {
            method: "PATCH", headers, body: JSON.stringify({ status: "failed" }),
          }).catch(() => null);
          results.push({ id: item.id, status: "failed", error: "montage_not_configured" });
          await scheduleNext(item);
          continue;
        }
        const title = item.task.split("\n")[0]?.replace(/[#*]/g, "").trim().slice(0, 100) || "Scheduled video";
        const r = await produceStudioVideo({ userId: item.user, script: item.task, title, tier: "pro" });
        await fetch(`${pbUrl}/api/collections/scheduled_content/records/${item.id}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ status: r.ok ? "completed" : "failed" }),
        }).catch(() => null);
        results.push(r.ok ? { id: item.id, status: "completed" } : { id: item.id, status: "failed", error: r.error });
        await scheduleNext(item);
        continue;
      }

      if (item.kind === "workflow_goal") {
        try {
          const { plan } = await planGoal(item.task);
          const { workflowId } = await materializePlan({
            pb: pbUrl,
            token,
            userId: item.user,
            goal: item.task,
            plan,
            reviewRequired: true,
          });
          await fetch(`${pbUrl}/api/collections/scheduled_content/records/${item.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "completed" }),
          });
          console.log(`Worker: recurring workflow started wf=${workflowId} goal="${item.task.slice(0, 60)}"`);
          results.push({ id: item.id, status: "completed" });
        } catch (err) {
          await fetch(`${pbUrl}/api/collections/scheduled_content/records/${item.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "failed" }),
          }).catch(() => null);
          results.push({ id: item.id, status: "failed", error: String(err) });
        }
        await scheduleNext(item);
        continue;
      }

      try {
        // Fetch vault for this user
        let vault: Record<string, unknown> | null = null;
        try {
          const bizRes = await fetch(
            `${pbUrl}/api/collections/businesses/records?filter=(user='${item.user}')&perPage=1`,
            { headers: { Authorization: token } }
          );
          if (bizRes.ok) {
            const bizData = (await bizRes.json()) as { items?: Record<string, unknown>[] };
            vault = bizData.items?.[0] ?? null;
          }
        } catch { /* proceed without vault */ }

        // W58.2 (D-19) — per-task trial state with industry bridging so
        // pack defaults resolve. Vault was just loaded above; failure here
        // degrades to generic defaults (Decision 2).
        let activePacks: string[] = [];
        try {
          const trial = await resolveDepartments(item.user, {
            vaultIndustry: bridgingIndustryFor(vault as { id?: string; industry?: string; industry_category?: string } | null),
          });
          activePacks = trial.activePacks;
        } catch { /* generic defaults */ }

        // Generate content
        const output = await generateContent(item.task, item.department, null, vault, activePacks);

        if (!output.trim()) throw new Error("Empty output");

        // Save to documents collection
        const saveRes = await fetch(`${pbUrl}/api/collections/documents/records`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            user: item.user,
            department: item.department,
            agent_name: item.agent_name || item.department,
            prompt: item.task,
            output,
          }),
        });

        // V4b — enqueue for Vault ingestion. Fire-and-forget; failure here
        // doesn't fail the scheduled job (backfill script will catch it).
        if (saveRes.ok) {
          try {
            const created = (await saveRes.json()) as { id?: string };
            if (created.id) void enqueue("document", created.id);
          } catch {
            /* parse failure is harmless — backfill picks it up */
          }
        }

        // Mark scheduled item as completed
        await fetch(`${pbUrl}/api/collections/scheduled_content/records/${item.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: "completed" }),
        });

        results.push({ id: item.id, status: "completed" });
      } catch (err) {
        // Mark as failed so it doesn't re-run infinitely
        await fetch(`${pbUrl}/api/collections/scheduled_content/records/${item.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status: "failed" }),
        }).catch(() => null);

        results.push({ id: item.id, status: "failed", error: String(err) });
      }
      // PR-Loop-V4 (#8) — recurring content reschedules regardless of outcome.
      await scheduleNext(item);
    }

    const completed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed").length;

    console.log(`Worker: ${completed} completed, ${failed} failed`);

    // V2 — daily p95 rollup of Vault retrieval latency. Logged so admin can
    // surface hot-spots; we don't persist the rollup itself (the raw rows in
    // `vault_retrieval_metrics` are the source of truth).
    let retrievalP95: Awaited<ReturnType<typeof computeRetrievalP95>> | null = null;
    try {
      retrievalP95 = await computeRetrievalP95(1);
      console.log(
        `Worker: vault retrieval p95 — global ${retrievalP95.globalP95Ms} ms across ${retrievalP95.samples} samples, ${Object.keys(retrievalP95.byUser).length} active users`
      );
    } catch (err) {
      console.warn("Worker: p95 rollup failed", err);
    }

    // Phase 2 / B3 cadence — nightly recompute of brand-voice profiles for
    // any user who has produced a doc in the last 7 days.
    let voiceProfileTally: Awaited<ReturnType<typeof recomputeActiveUserVoiceProfiles>> | null = null;
    try {
      voiceProfileTally = await recomputeActiveUserVoiceProfiles(7);
      console.log(
        `Worker: voice profile rollup — scanned=${voiceProfileTally.scanned} ok=${voiceProfileTally.ok} skipped=${voiceProfileTally.skipped} failed=${voiceProfileTally.failed}`
      );
    } catch (err) {
      console.warn("Worker: voice profile rollup failed", err);
    }

    return Response.json({
      ok: true,
      processed: items.length,
      completed,
      failed,
      results,
      retrievalP95,
      voiceProfileTally,
    });
  } catch (err) {
    console.error("Worker error:", err);
    return Response.json({ error: "Worker failed", detail: String(err) }, { status: 500 });
  }
}
