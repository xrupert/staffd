/**
 * GET /api/worker/workflow-drain
 *
 * Workflow task drain — runs on a per-minute cron schedule.
 * Pulls pending/retrying workflow_tasks whose dependencies are
 * satisfied, marks them running, invokes /api/agent, then
 * persists the outcome.
 *
 * Auth: CRON_SECRET Bearer (Vercel cron) or WORKER_SECRET header
 * (manual testing). No new Anthropic SDK site — calls /api/agent
 * via HTTP per W71 spec and W61′ SDK allowlist constraint (9 sites max).
 *
 * W71 — Task Bus substrate.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { drainTasks } from "../../_lib/workflow";
import type { WorkflowTask, WorkflowTaskStatus, DrainDeps } from "../../_lib/workflow";

const TASKS_PER_TICK = 10;

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

export async function GET(req: Request) {
  const authHeader  = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  const cronSecret  = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";

  const validCron   = cronSecret   && authHeader === `Bearer ${cronSecret}`;
  const validManual = workerSecret && workerHeader === workerSecret;

  if (!validCron && !validManual) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pb = pbUrl();
  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const authHeaders = { Authorization: adminToken, "Content-Type": "application/json" };

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const deps: DrainDeps = {
    fetchPendingTasks: async () => {
      const filter = encodeURIComponent(`(status = "pending" || status = "retrying")`);
      const res = await fetch(
        `${pb}/api/collections/workflow_tasks/records?filter=${filter}&perPage=${TASKS_PER_TICK}&sort=created`,
        { headers: { Authorization: adminToken } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { items: WorkflowTask[] };
      return data.items ?? [];
    },

    getTaskStatus: async (taskId: string) => {
      const res = await fetch(
        `${pb}/api/collections/workflow_tasks/records/${taskId}`,
        { headers: { Authorization: adminToken } },
      );
      if (!res.ok) return null;
      const record = (await res.json()) as { status?: string };
      return (record.status as WorkflowTaskStatus) ?? null;
    },

    updateTask: async (taskId: string, patch: Partial<WorkflowTask>) => {
      await fetch(
        `${pb}/api/collections/workflow_tasks/records/${taskId}`,
        {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify(patch),
        },
      );
    },

    runAgent: async (task: WorkflowTask) => {
      const res = await fetch(`${baseUrl}/api/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task:       String(task.input_payload.task ?? JSON.stringify(task.input_payload)),
          department: task.department_id,
          agentId:    task.specialist_id ?? undefined,
          userId:     task.user,
          pbToken:    adminToken,
        }),
      });
      if (!res.ok) throw new Error(`Agent call failed: ${res.status}`);
      if (!res.body) throw new Error("Agent returned no body");
      const text = await consumeStream(res.body);
      return { text, tokensActual: 0 };
    },
  };

  try {
    const result = await drainTasks(deps);
    console.log(
      `workflow-drain: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("workflow-drain error:", err);
    return Response.json({ error: "Drain failed" }, { status: 500 });
  }
}
