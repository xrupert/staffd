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
import { parsePlan, ALL_DEPTS } from "../../_lib/orchestrator/planner";
import { materializePlan } from "../../_lib/workflow-materialize";

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

  // PR-Loop-V4 (#8) — materialization shared with the recurring worker.
  // Wire-the-loop — `goal` is stored on the workflow so the drain can
  // generate follow-on suggestions when the workflow completes.
  try {
    const { workflowId, taskCount } = await materializePlan({
      pb,
      token,
      userId: me.id,
      goal,
      plan,
      reviewRequired: false,
    });
    return Response.json({ ok: true, workflowId, taskCount });
  } catch (err) {
    console.error("[workflow.commit] materialize failed:", err);
    return Response.json({ error: "workflow_create_failed" }, { status: 500 });
  }
}
