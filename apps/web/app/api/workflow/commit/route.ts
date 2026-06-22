/**
 * POST /api/workflow/commit  (W73 / L4 — RATIFY)
 *
 * Owner-authed. Takes a plan the user approved (from POST /api/workflow/plan) and
 * materializes it onto the EXISTING execution substrate: one parent `workflows`
 * row + N `workflow_tasks` rows (department_id + input_payload.task + depends_on).
 * The per-minute `workflow-drain` cron then runs the DAG honoring dependencies and
 * `reconcileWorkflow` completes the parent + aggregates.
 *
 * The plan is re-validated here with the SAME parsePlan trust boundary — the
 * client-sent plan is never trusted (departments must be routable, deps must
 * reference earlier steps, bounded size), so a tampered preview can't create an
 * unsound or oversized workflow.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { parsePlan, planToTaskSeeds, ALL_DEPTS } from "../../_lib/orchestrator/planner";

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { goal?: unknown; plan?: unknown };
  try {
    body = (await req.json()) as { goal?: unknown; plan?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const goal = String(body.goal ?? "").trim();
  if (goal.length < 3) return Response.json({ error: "goal_required" }, { status: 400 });

  let plan;
  try {
    plan = parsePlan(body.plan, goal, ALL_DEPTS); // re-validate the client-approved plan
  } catch (err) {
    return Response.json({ error: "plan_invalid", detail: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }

  const pb = pbUrl();
  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const headers = { Authorization: token, "Content-Type": "application/json" };

  const wfRes = await fetch(`${pb}/api/collections/workflows/records`, {
    method: "POST", headers,
    body: JSON.stringify({ user: me.id, status: "pending", review_required: false }),
  });
  if (!wfRes.ok) return Response.json({ error: "workflow_create_failed" }, { status: 500 });
  const workflowId = ((await wfRes.json()) as { id: string }).id;

  // Steps are topologically ordered (parsePlan guarantees deps reference earlier
  // steps), so create in order and resolve step index → created task id.
  const idByStep: string[] = [];
  for (const seed of planToTaskSeeds(plan)) {
    const taskRes = await fetch(`${pb}/api/collections/workflow_tasks/records`, {
      method: "POST", headers,
      body: JSON.stringify({
        workflow_id: workflowId,
        user: me.id,
        specialist_id: "",
        department_id: seed.department_id,
        input_payload: seed.input_payload,
        output_payload: null,
        status: "pending",
        depends_on: seed.dependsOnSteps.map((i) => idByStep[i]).filter(Boolean),
        retry_count: 0,
        error: "",
        started_at: "",
        completed_at: "",
        cost_estimate_tokens: 0,
        cost_actual_tokens: 0,
      }),
    });
    if (!taskRes.ok) return Response.json({ error: "task_create_failed", workflowId, createdStep: seed.stepIndex }, { status: 500 });
    idByStep.push(((await taskRes.json()) as { id: string }).id);
  }

  return Response.json({ ok: true, workflowId, taskCount: plan.steps.length });
}
