/**
 * PR-Loop-V4 (#8) — plan → workflow materializer, extracted from
 * /api/workflow/commit so the recurring scheduled worker creates
 * workflows through the identical path (same task-seed shape, same
 * topological id resolution). Throws on any PB failure.
 */

import { planToTaskSeeds, type Plan } from "./orchestrator/planner";

export async function materializePlan(opts: {
  pb: string;
  token: string;
  userId: string;
  goal: string;
  plan: Plan;
  /** Recurring/autonomous workflows MUST review-gate (HITL on outbound). */
  reviewRequired: boolean;
}): Promise<{ workflowId: string; taskCount: number }> {
  const headers = { Authorization: opts.token, "Content-Type": "application/json" };

  const wfRes = await fetch(`${opts.pb}/api/collections/workflows/records`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: opts.userId,
      status: "pending",
      review_required: opts.reviewRequired,
      goal: opts.goal,
    }),
  });
  if (!wfRes.ok) throw new Error(`workflow_create_failed: ${wfRes.status}`);
  const workflowId = ((await wfRes.json()) as { id: string }).id;

  // Steps are topologically ordered (parsePlan guarantees deps reference
  // earlier steps), so create in order and resolve step index → task id.
  const idByStep: string[] = [];
  for (const seed of planToTaskSeeds(opts.plan)) {
    const taskRes = await fetch(`${opts.pb}/api/collections/workflow_tasks/records`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workflow_id: workflowId,
        user: opts.userId,
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
    if (!taskRes.ok) throw new Error(`task_create_failed at step ${seed.stepIndex}: ${taskRes.status}`);
    idByStep.push(((await taskRes.json()) as { id: string }).id);
  }

  return { workflowId, taskCount: opts.plan.steps.length };
}
