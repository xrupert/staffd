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
import { drainTasks, reconcileWorkflow } from "../../_lib/workflow";
import type {
  WorkflowTask,
  WorkflowTaskStatus,
  WorkflowStatus,
  WorkflowRecord,
  DrainDeps,
  ReconcileDeps,
} from "../../_lib/workflow";
import { logWorkflowTransition } from "../../_lib/auth/super-admin-logging";
import { WORKER_HANDLERS } from "../../_lib/worker/handlers";
import { notifyUser } from "../../_lib/notifications/notify";

const TASKS_PER_TICK = 10;

// The drain processes up to TASKS_PER_TICK tasks per invocation, some of which
// call /api/agent (LLM, slow). At Vercel's low default function timeout a batch
// could be killed mid-task, orphaning a task in "running". Raise the ceiling so
// a normal batch finishes cleanly (Pro plan allows up to 300s).
export const maxDuration = 60;

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

  // Workflow ids touched this tick — reconciled to their parent workflow
  // status after the task drain (W72).
  const touchedWorkflowIds = new Set<string>();

  const deps: DrainDeps = {
    fetchPendingTasks: async () => {
      const filter = encodeURIComponent(`(status = "pending" || status = "retrying")`);
      const res = await fetch(
        `${pb}/api/collections/workflow_tasks/records?filter=${filter}&perPage=${TASKS_PER_TICK}&sort=created`,
        { headers: { Authorization: adminToken } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { items: WorkflowTask[] };
      const items = data.items ?? [];
      for (const t of items) if (t.workflow_id) touchedWorkflowIds.add(t.workflow_id);
      return items;
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
      // W95.4a — system/bus tasks (vendor mirrors, document extraction, …) are
      // NOT agent work. Each is keyed by specialist_id in WORKER_HANDLERS; the
      // handler does the work and any throw flows into W71's retry/exhaustion.
      const handler = WORKER_HANDLERS[task.specialist_id ?? ""];
      if (handler) {
        return handler(task, { pb, adminToken, authHeaders });
      }

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

  // W72 — reconcile each touched parent workflow to its derived status,
  // running the aggregate hook when all tasks succeed.
  const reconcileDeps: ReconcileDeps = {
    getWorkflow: async (id) => {
      const res = await fetch(`${pb}/api/collections/workflows/records/${id}`, {
        headers: { Authorization: adminToken },
      });
      if (!res.ok) return null;
      const r = (await res.json()) as { id: string; user?: string; status?: string; aggregation_doc_id?: string; started_at?: string; review_required?: boolean; draft_output?: string };
      return {
        id: r.id,
        user: r.user ?? "",
        status: (r.status as WorkflowStatus) || "pending",
        aggregation_doc_id: r.aggregation_doc_id || null,
        started_at: r.started_at || null,
        review_required: !!r.review_required,
        draft_output: r.draft_output || null,
      } satisfies WorkflowRecord;
    },
    getDraftOutput: async (workflowId) => {
      // The draft is the earliest task's output (the specialist's work product).
      const f = encodeURIComponent(`(workflow_id = "${workflowId}")`);
      const res = await fetch(`${pb}/api/collections/workflow_tasks/records?filter=${f}&perPage=1&sort=created&fields=output_payload`, { headers: { Authorization: adminToken } });
      if (!res.ok) return "";
      const t = (((await res.json()) as { items?: { output_payload?: { text?: string } }[] }).items ?? [])[0];
      return t?.output_payload?.text ?? "";
    },
    getTaskStatuses: async (workflowId) => {
      const f = encodeURIComponent(`(workflow_id = "${workflowId}")`);
      const res = await fetch(
        `${pb}/api/collections/workflow_tasks/records?filter=${f}&perPage=200&fields=status`,
        { headers: { Authorization: adminToken } },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { items?: { status?: string }[] };
      return (data.items ?? []).map((t) => (t.status as WorkflowTaskStatus) ?? "pending");
    },
    updateWorkflow: async (id, patch) => {
      await fetch(`${pb}/api/collections/workflows/records/${id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify(patch),
      });
    },
    runAggregator: async (workflowId) => {
      const res = await fetch(`${baseUrl}/api/workflow/aggregate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": workerSecret },
        body: JSON.stringify({ workflow_id: workflowId }),
      });
      if (!res.ok) throw new Error(`aggregate failed: ${res.status}`);
      const data = (await res.json()) as { documentId?: string };
      return data.documentId ?? "";
    },
    logTransition: (e) => logWorkflowTransition(e),
    // W95.8 — ping the owner when their planned workflow finishes (best-effort).
    onComplete: (e) => notifyUser(pb, adminToken, e.user, "workflow.completed", { workflowId: e.workflowId, docId: e.docId }),
  };

  try {
    const result = await drainTasks(deps);

    const transitions: { workflowId: string; from: string; to: string }[] = [];
    for (const id of touchedWorkflowIds) {
      try {
        const r = await reconcileWorkflow(id, reconcileDeps);
        if (r.changed) transitions.push({ workflowId: id, from: r.from, to: r.to });
      } catch (err) {
        console.error(`workflow-drain reconcile error (wf=${id}):`, err);
      }
    }

    console.log(
      `workflow-drain: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped} transitions=${transitions.length}`
    );
    return Response.json({ ok: true, ...result, transitions });
  } catch (err) {
    console.error("workflow-drain error:", err);
    return Response.json({ error: "Drain failed" }, { status: 500 });
  }
}
