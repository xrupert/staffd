import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getAgent, getDepartmentDefaultAgent, routeTask, type Department } from "@staffd/agents";
import { fetchVault, renderVaultBlock, retrieve } from "../_lib/vault";
import { recordTrialRun, resolveDepartments } from "../_lib/trial";
import { checkAndIncrementRateLimit } from "../_lib/ratelimit";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import { enqueue } from "../_lib/vault/queue";
import { runOrchestrator } from "../_lib/orchestrator";
import { getVoiceBlock } from "../_lib/vault/voice";
import { pickModel, callGroq, computeCostUsd, MODELS } from "../_lib/llm-router";
import { bridgingIndustryFor } from "../_lib/industry";
import { trySuperAdminFromToken } from "../_lib/auth/super-admin";
import { logSuperAdminUsage } from "../_lib/auth/super-admin-logging";
import { ensureConversationThreadRow } from "../_lib/conversations";

const anthropic = new Anthropic();

// Department-level base prompts live in `packages/agents` via
// `getDepartmentDefaultAgent()` — single source of truth. CEO is handled
// upstream: `department === "ceo"` short-circuits to the orchestrator's
// intent="synthesize" handler below (B4).

/**
 * V5 — Write a single conversation turn to PocketBase and enqueue it for
 * Vault ingestion. Fire-and-forget; never throws, never blocks streaming.
 * Errors are swallowed because the streaming response is the user-facing
 * surface and a missed turn is preferable to a broken generation.
 */
async function writeConversationTurnAndEnqueue(opts: {
  threadId: string;
  user: string;
  client?: string;
  department?: string;
  agentId?: string;
  role: "user" | "assistant";
  content: string;
}): Promise<void> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/conversations/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: opts.user,
        client: opts.client ?? "",
        thread_id: opts.threadId,
        department: opts.department ?? "",
        agent_id: opts.agentId ?? "",
        role: opts.role,
        content: opts.content,
      }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as { id?: string };
    if (created.id) {
      void enqueue("conversation", created.id);
    }
    // Phase 25 — make sure the thread has a metadata row so the picker UI
    // can list it with a derived name. Idempotent via unique index.
    void ensureConversationThreadRow({
      userId: opts.user,
      threadId: opts.threadId,
      firstTurnContent: opts.content,
    });
  } catch {
    /* fire-and-forget */
  }
  void pbEscape; // import kept available for future PB queries from this route
}

export async function POST(req: Request) {
  try {
    const {
      task,
      department,
      agentId,
      userId,
      pbToken,
      templateContent,
      clientId,
      threadId: incomingThreadId,
    } = (await req.json()) as {
      task: string;
      department: string;
      agentId?: string;
      userId: string;
      pbToken: string;
      templateContent?: string;
      clientId?: string; // Agency: scope vault to this client
      threadId?: string; // V5 — optional client-supplied conversation thread id
    };

    // V5 — Every /api/agent call belongs to a conversation thread. Client may
    // supply one to maintain context across requests; otherwise we generate
    // a fresh one and the thread is single-turn.
    const threadId = incomingThreadId?.trim() || randomUUID();

    if (!task?.trim()) {
      return new Response("Task is required", { status: 400 });
    }

    // X2 — cross-instance daily rate limit, PB-backed.
    const rateLimitKey = userId || req.headers.get("x-forwarded-for") || "anonymous";
    const { allowed: rateLimitAllowed } = await checkAndIncrementRateLimit(rateLimitKey);
    if (!rateLimitAllowed) {
      return new Response("Daily generation limit reached. Limit resets in 24 hours.", {
        status: 429,
        headers: { "X-RateLimit-Remaining": "0" },
      });
    }

    // Trial gate — direct lib call, no self-HTTP.
    if (userId) {
      const trial = await recordTrialRun(userId, department);
      if (!trial.allowed) {
        return new Response(
          JSON.stringify({ error: "trial_exhausted", plan: trial.plan }),
          { status: 402, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // B4 — CEO dept generations delegate to the orchestrator's
    // intent="synthesize" handler, which owns the vault + cross-department
    // workload + prior CEO continuity assembly. We persist both turns here
    // for parity with the non-CEO path, then stream the synthesized text as
    // a single chunk (the orchestrator is non-streaming today).
    if (department === "ceo") {
      if (userId) {
        void writeConversationTurnAndEnqueue({
          threadId, user: userId, client: clientId, department, agentId, role: "user", content: task,
        });
      }
      const synth = await runOrchestrator({
        intent: "synthesize",
        userId,
        pbToken,
        clientId,
        context: { query: task, agentId },
      });
      const synthText = synth.ok
        ? (synth.decision.task ?? "").trim()
        : (synth.degraded.task ?? "").trim();
      const finalText = synthText.length > 0
        ? synthText
        // PR-Tranche-2.6.2 — brand-voiced + accurate-regardless-of-cause
        : "Working from limited context right now — your specialists are still on duty. Try again in a moment.";

      if (userId) {
        void writeConversationTurnAndEnqueue({
          threadId, user: userId, client: clientId, department, agentId, role: "assistant", content: finalText,
        });
      }

      const encoder = new TextEncoder();
      const ceoStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(finalText));
          controller.close();
        },
      });
      return new Response(ceoStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // Vault fetch — single shared helper. Agency mode handled inside fetchVault.
    // Phase 2 — voice block. Phase 8 — active packs (used by the default-agent
    // resolver below so packed specialists take priority over generic ones).
    // W58.2 (D-19 bridging) — vault loads first so its industry can drive
    // pack auto-activation in resolveDepartments. One serialized PB read.
    const vault = pbToken && userId
      ? await fetchVault(pbToken, userId, { clientId })
      : null;
    const [voiceBlock, trialStateForPacks] = await Promise.all([
      getVoiceBlock(userId, department),
      userId ? resolveDepartments(userId, { vaultIndustry: bridgingIndustryFor(vault) }) : Promise.resolve(null),
    ]);
    const vaultBlock = renderVaultBlock(vault, { detail: "full" });
    const activePacks = trialStateForPacks?.activePacks ?? [];

    // V5 — Semantic retrieval from the Living Vault. When at least one
    // relevant artifact comes back, we inject it as the LIVING MEMORY block
    // AND suppress the legacy "last-2 same-dept docs" fallback below.
    // Degraded / empty retrieval falls through to the legacy memory path so
    // there is never a regression vs. pre-V5 behaviour.
    let livingMemoryBlock = "";
    let retrievalCostFlag: "ok" | "trimmed" | "degraded" | null = null;
    if (userId && task?.trim()) {
      try {
        const retrieval = await retrieve(userId, task, {
          topK: 10,
          maxTokens: 4_000,
          clientId: clientId ?? null,
          intent: "agent",
          preferDept: department,
        });
        retrievalCostFlag = retrieval.costFlag;
        if (retrieval.items.length > 0) {
          livingMemoryBlock =
            `\n\n--- LIVING MEMORY (semantically relevant past work — context, do not repeat) ---\n` +
            retrieval.items.map((it) => `• [${it.dept ?? "?"}] ${it.text}`).join("\n") +
            `\n--- END LIVING MEMORY ---`;
          console.log(
            `[agent] LIVING MEMORY injected: items=${retrieval.items.length} tokens=${retrieval.tokensReturned} cost_flag=${retrieval.costFlag} dept=${department}`
          );
        } else {
          console.log(
            `[agent] no LIVING MEMORY items (cost_flag=${retrieval.costFlag}) — falling through to legacy memory`
          );
        }
      } catch (err) {
        // Retrieval failures are non-fatal — log and fall through to legacy
        // memory so the request still produces work.
        console.warn("[agent] retrieve failed, falling back to legacy memory:", err);
      }
    }

    // System prompt — agent resolution order (W95.7.3d-h5):
    //   1. caller-pinned agentId (explicit wins)
    //   2. the SPECIALIST whose tags best match the task (routeTask) — this is
    //      why "make a tiktok video" now reaches the TikTok Strategist instead of
    //      the generic department default it used to fall straight through to.
    //   3. the department's canonical default (pack-aware per Phase 8).
    // Voice fingerprint (Phase 2) appended after vault for voice-applicable depts.
    const resolvedAgent =
      (agentId ? getAgent(agentId) : null)
      ?? (task?.trim() ? routeTask(task, department as Department, { activePacks }) : null)
      ?? getDepartmentDefaultAgent(department, activePacks);
    let systemPrompt = (resolvedAgent?.systemPrompt ?? "") + vaultBlock + voiceBlock;

    // V5 — LIVING MEMORY goes in right after the vault block, before the
    // legacy memory paths below. When this is populated, the non-CEO
    // same-dept fallback is suppressed (CEO cross-dept synthesis stays —
    // B4 will move that under intent="synthesize").
    if (livingMemoryBlock) {
      systemPrompt += livingMemoryBlock;
    }

    // Legacy memory injection (non-CEO only — CEO handled upstream by B4).
    // Same-department continuity (last 2 docs) is SUPPRESSED when V5 LIVING
    // MEMORY is already populated; it only runs as a fallback when retrieval
    // returned no items.
    if (userId && pbToken && !livingMemoryBlock) {
      try {
        const url = pbUrl();
        const escapedUser = pbEscape(userId);
        const filter = `(user='${escapedUser}' && department='${pbEscape(department)}')`;
        const memRes = await fetch(
          `${url}/api/collections/documents/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=2&fields=prompt,output,created`,
          { headers: { Authorization: pbToken } }
        );
        if (memRes.ok) {
          const memData = (await memRes.json()) as { items?: Array<{ prompt: string; output: string; created: string }> };
          const prior = memData.items ?? [];
          if (prior.length > 0) {
            const memoryBlock = prior
              .map((d, i) => {
                const summary = d.output.length > 500 ? d.output.slice(0, 500) + "…" : d.output;
                return `[Prior task ${i + 1}]\nTask: ${d.prompt}\nOutput: ${summary}`;
              })
              .join("\n\n");
            systemPrompt += `\n\n--- PRIOR WORK (context only — do not repeat) ---\n${memoryBlock}\n--- END PRIOR WORK ---`;
          }
        }
      } catch {
        // proceed without memory
      }
    }

    if (templateContent?.trim()) {
      systemPrompt += `\n\n--- USER TEMPLATE ---\nThe user has provided an existing document template. Use this EXACT structure, layout, and format as your output. Replace placeholder values and example data with the appropriate content for this task. Preserve every section heading, field label, and formatting pattern from the template.\n\n${templateContent.trim()}\n--- END TEMPLATE ---`;
    }

    // V5 — Persist the user turn before generation. Fire-and-forget so the
    // PB write never blocks streaming. The created turn id is enqueued for
    // Vault ingestion.
    if (userId) {
      void writeConversationTurnAndEnqueue({
        threadId,
        user: userId,
        client: clientId,
        department,
        agentId,
        role: "user",
        content: task,
      });
    }

    // Phase 3 — model routing. Cheap tier for short-form (captions, replies,
    // taglines). Sonnet always for legal/finance/operations + long-form.
    // Groq Llama only activates for short-form when GROQ_API_KEY is set.
    let choice = pickModel({ department, agentId, task });
    console.log(`[agent] model_choice provider=${choice.provider} model=${choice.model} dept=${department} task_chars=${task.length} reason="${choice.reason}"`);

    // W47 — agent-credit deduction removed: specialist conversations are
    // unlimited per ARCH §12; the X2 daily rate limit (50/day) is the gate.
    //
    // Decision 74 — super-admin usage logging preserved intact: premium
    // operations triggered by super-admin are logged to
    // super_admin_usage_log for visibility.
    if (userId) {
      const pbUrlVal = process.env.NEXT_PUBLIC_POCKETBASE_URL;
      if (pbUrlVal) {
        void (async () => {
          const admin = await trySuperAdminFromToken(pbToken);
          if (admin) {
            await logSuperAdminUsage(admin, "agent_credit_spend", {
              operation_detail: `${department}/${agentId ?? "default"}`,
              parameters: { task_chars: task.length, threadId },
            });
          }
        })();
      }
    }

    const encoder = new TextEncoder();

    // ── Groq path (short-form, non-streaming) ───────────────────────────
    // T1-4 — on Groq failure (outage / rate-limit / network) we DON'T 500.
    // We fall through to the Anthropic Haiku streaming path below so the
    // user still gets their work. Groq is a cost optimization, never a
    // single point of failure for short-form generation.
    if (choice.provider === "groq") {
      try {
        const result = await callGroq(choice.model, systemPrompt, task, 8192);
        const assistantText = result.text;
        const cost = computeCostUsd(choice.model, result.tokensIn, result.tokensOut);
        console.log(`[agent] groq_cost model=${choice.model} in=${result.tokensIn} out=${result.tokensOut} cost_usd=${cost.toFixed(6)}`);

        if (userId && assistantText.trim()) {
          void writeConversationTurnAndEnqueue({
            threadId, user: userId, client: clientId, department, agentId,
            role: "assistant", content: assistantText,
          });
        }

        void retrievalCostFlag;
        const groqStream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(assistantText));
            controller.close();
          },
        });
        return new Response(groqStream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (err) {
        // Fall back to Anthropic Haiku (same short-form tier) instead of
        // failing. Reassign `choice` and drop through to the Anthropic path.
        console.warn("[agent] Groq call failed, falling back to Anthropic Haiku:", err);
        choice = { provider: "anthropic", model: MODELS.haiku, family: "haiku", reason: "groq fallback" };
      }
    }

    // ── Anthropic path (streaming, default) ─────────────────────────────
    const stream = await anthropic.messages.stream({
      model: choice.model,
      max_tokens: 8192,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" }, // cache system prompt — vault context is expensive to reprocess
        },
      ],
      messages: [{ role: "user", content: task }],
    });

    const readable = new ReadableStream({
      async start(controller) {
        // V5 — accumulate streamed text so we can persist the assistant turn
        // and enqueue it for Vault ingestion after the stream closes.
        let assistantText = "";
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            assistantText += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();

        // Phase 3 — log cost from final message usage so ops can see the
        // per-call wedge between Sonnet and Haiku.
        try {
          const final = await stream.finalMessage();
          const tokensIn = final.usage?.input_tokens ?? 0;
          const tokensOut = final.usage?.output_tokens ?? 0;
          const cost = computeCostUsd(choice.model, tokensIn, tokensOut);
          console.log(`[agent] anthropic_cost model=${choice.model} in=${tokensIn} out=${tokensOut} cost_usd=${cost.toFixed(6)}`);
        } catch { /* cost log is best-effort */ }

        if (userId && assistantText.trim()) {
          void writeConversationTurnAndEnqueue({
            threadId,
            user: userId,
            client: clientId,
            department,
            agentId,
            role: "assistant",
            content: assistantText,
          });
        }
      },
    });

    void retrievalCostFlag; // surfaced via logs; reserved for future telemetry header
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Agent route error:", err);
    return new Response("Something went wrong", { status: 500 });
  }
}
