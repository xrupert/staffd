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
import { getAgent } from "@staffd/agents";

const anthropic = new Anthropic();

const DEPT_SYSTEM_PROMPTS: Record<string, string> = {
  marketing:  "You are The Marketer — STAFFD's AI marketing specialist. Produce sharp, specific marketing output. Deliver immediately, no preamble.",
  sales:      "You are The Closer — STAFFD's AI sales specialist. Write outreach, follow-ups, and sales copy that converts. Deliver immediately.",
  legal:      "You are The Counsel — STAFFD's AI legal drafting specialist. Draft documents in plain, professional language. Deliver immediately.",
  hr:         "You are The People Lead — STAFFD's AI HR specialist. Handle hiring, onboarding, and team communications. Deliver immediately.",
  finance:    "You are The CFO — STAFFD's AI finance specialist. Produce financial documents and communications. Deliver immediately.",
  operations: "You are The Operator — STAFFD's AI operations specialist. Create SOPs, workflows, and process documentation. Deliver immediately.",
  ceo:        "You are The CEO — STAFFD's strategic advisor. Give direct, opinionated strategic advice with clear next steps. Deliver immediately.",
  "paid-media": "You are The Media Buyer — STAFFD's paid media specialist. Create ad strategy and campaign briefs. Deliver immediately.",
  design:     "You are The Creative Director — STAFFD's design specialist. Provide design direction, briefs, and creative strategy. Deliver immediately.",
  reputation: "You are The Reputation Manager — STAFFD's reputation specialist. Handle support replies, review responses, community engagement and feedback analysis. Deliver immediately.",
};

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

async function generateContent(task: string, department: string, agentId: string | null, vault: Record<string, unknown> | null): Promise<string> {
  let systemPrompt = agentId
    ? (getAgent(agentId)?.systemPrompt ?? DEPT_SYSTEM_PROMPTS[department] ?? "")
    : (DEPT_SYSTEM_PROMPTS[department] ?? "");

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

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: task }],
  });

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
      }>;
    };

    const items = listData.items ?? [];
    if (items.length === 0) {
      return Response.json({ ok: true, processed: 0, message: "No items due" });
    }

    const results: Array<{ id: string; status: "completed" | "failed"; error?: string }> = [];

    for (const item of items) {
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

        // Generate content
        const output = await generateContent(item.task, item.department, null, vault);

        if (!output.trim()) throw new Error("Empty output");

        // Save to documents collection
        await fetch(`${pbUrl}/api/collections/documents/records`, {
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
    }

    const completed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed").length;

    console.log(`Worker: ${completed} completed, ${failed} failed`);
    return Response.json({ ok: true, processed: items.length, completed, failed, results });
  } catch (err) {
    console.error("Worker error:", err);
    return Response.json({ error: "Worker failed", detail: String(err) }, { status: 500 });
  }
}
