/**
 * POST /api/workflow/plan  (W73 / L4 — PREVIEW)
 *
 * Owner-authed. Takes a high-level goal, asks the LLM to decompose it, validates
 * the result into a sound DAG (parsePlan — the trust boundary), and RETURNS the
 * plan WITHOUT persisting anything. The user reviews it; POST /api/workflow/commit
 * then materializes the approved plan onto the execution substrate. This
 * propose-then-ratify split means an automated multi-step workflow never spends
 * the customer's agent calls / tokens until they've seen and approved the plan
 * (consistent with STAFFD's tier-picker + confirm-to-commit patterns).
 *
 * PR-Loop-V1 (#3): every plan is pre-mortemed by the critic before the owner
 * sees it. PR-Loop-V4 (#8): the planner+critic pipeline lives in
 * _lib/orchestrator/plan-goal.ts, shared with the recurring scheduled worker.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { planGoal, PlannerUnavailableError, extractPlanJson as extractPlanJsonShared } from "../../_lib/orchestrator/plan-goal";

/** Re-export (tests + historical imports). */
export const extractPlanJson = extractPlanJsonShared;

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let goal = "";
  try {
    goal = String(((await req.json()) as { goal?: unknown }).goal ?? "").trim();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (goal.length < 3) return Response.json({ error: "goal_required" }, { status: 400 });

  try {
    const { plan, critique } = await planGoal(goal);
    return Response.json({
      ok: true,
      goal,
      plan,
      steps: plan.steps,
      critique: { verdict: critique.verdict, concerns: critique.concerns },
    });
  } catch (err) {
    if (err instanceof PlannerUnavailableError) {
      return Response.json({ error: "planner_unavailable" }, { status: 502 });
    }
    return Response.json({ error: "plan_invalid", detail: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }
}
