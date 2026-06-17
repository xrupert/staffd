/**
 * POST /api/workflow/aggregate  — workflow aggregation hook (W72).
 *
 * When every task in a workflow has succeeded, the lifecycle calls this to
 * synthesize the task artifacts into a single unified work product (the
 * Launch Brief, Onboarding Pack, etc.). W72 ships the HOOK only: it persists
 * a stub `documents` record that references each task output and returns its
 * id, so the state machine can reach `completed` cleanly. W74's recipe
 * library will define what aggregation actually produces per recipe.
 *
 * Internal-only: guarded by ADMIN_SECRET (`x-admin-secret`) or worker context
 * (`x-worker-secret` === WORKER_SECRET). Body: { workflow_id }.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";

type Body = { workflow_id?: string };

function authorized(req: Request): boolean {
  const adminSecret = (process.env.ADMIN_SECRET ?? "").trim();
  const workerSecret = (process.env.WORKER_SECRET ?? "").trim();
  const providedAdmin = (req.headers.get("x-admin-secret") ?? "").trim();
  const providedWorker = (req.headers.get("x-worker-secret") ?? "").trim();
  if (adminSecret && providedAdmin === adminSecret) return true;
  if (workerSecret && providedWorker === workerSecret) return true;
  return false;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workflowId = (body.workflow_id ?? "").trim();
  if (!workflowId) {
    return Response.json({ error: "workflow_id is required" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const pb = pbUrl();

  // Workflow record — for the owner + the original goal.
  const wfRes = await fetch(`${pb}/api/collections/workflows/records/${encodeURIComponent(workflowId)}`, {
    headers: { Authorization: token },
  });
  if (!wfRes.ok) {
    return Response.json({ error: "workflow_not_found" }, { status: 404 });
  }
  const wf = (await wfRes.json()) as { user?: string; root_goal?: string };

  // Task artifacts in dependency/creation order.
  const filter = encodeURIComponent(`(workflow_id = "${pbEscape(workflowId)}")`);
  const tasksRes = await fetch(
    `${pb}/api/collections/workflow_tasks/records?filter=${filter}&perPage=200&sort=created`,
    { headers: { Authorization: token } },
  );
  const tasks = tasksRes.ok
    ? ((await tasksRes.json()) as { items?: { id: string; department_id?: string; output_payload?: { text?: string } | null }[] }).items ?? []
    : [];

  // V1 stub synthesis — concatenated artifact references. W74 replaces this
  // with the per-recipe aggregator specialist.
  const sections = tasks.map((t, i) => {
    const text = t.output_payload?.text ?? "(no output)";
    return `## Step ${i + 1} — ${t.department_id ?? "work"}\n\n${text}`;
  });
  const output = [
    `# Workflow work product`,
    wf.root_goal ? `\n_Goal: ${wf.root_goal}_` : "",
    `\n\n${sections.join("\n\n") || "_No task artifacts yet._"}`,
    `\n\n---\n_Draft synthesis (W72 stub). Recipe-aware aggregation arrives in W74._`,
  ].join("");

  const docRes = await fetch(`${pb}/api/collections/documents/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: wf.user ?? "",
      department: "operations",
      agent_name: "Workflow Aggregator",
      prompt: wf.root_goal || "Workflow work product",
      output,
    }),
  });
  if (!docRes.ok) {
    const detail = await docRes.text().catch(() => "");
    console.error("[workflow/aggregate] document create failed:", detail.slice(0, 200));
    return Response.json({ error: "aggregation_failed" }, { status: 502 });
  }

  const doc = (await docRes.json()) as { id: string };
  return Response.json({ ok: true, documentId: doc.id, taskCount: tasks.length, stub: true });
}
