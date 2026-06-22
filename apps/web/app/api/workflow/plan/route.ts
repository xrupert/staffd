/**
 * POST /api/workflow/plan  (W73 / L4 — the planner that makes STAFFD an
 * "automated team" rather than a single-shot chat)
 *
 * Owner-authed. Takes a high-level goal, asks the LLM to decompose it, validates
 * the result into a sound DAG (parsePlan — the trust boundary), then materializes
 * it onto the EXISTING execution substrate: one parent `workflows` row + N
 * `workflow_tasks` rows (department_id + input_payload.task + depends_on). From
 * there the already-built per-minute `workflow-drain` cron runs the DAG honoring
 * dependencies and `reconcileWorkflow` completes the parent + aggregates. This
 * route adds the brain; it reuses all of the execution machinery unchanged.
 *
 * Tranche-2 debt (surfaced): the LLM call piggybacks the orchestrator
 * "synthesize" intent/policy (no new SDK site, no Record<OrchestratorIntent>
 * ripple). A dedicated `plan` intent + policy (correct telemetry/cost
 * attribution per Standard #33, and a stronger model) is the next refinement.
 * Live LLM-decomposition quality + end-to-end execution are operator-verified
 * (OPERATOR_TEST_QUEUE) — not unit-coverable here.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { callLLM } from "../../_lib/orchestrator/llm";
import { ALL_DEPTS } from "../../_lib/orchestrator/handlers/route";
import { buildPlannerPrompt, parsePlan, planToTaskSeeds } from "../../_lib/orchestrator/planner";

/** Pull the JSON object/array out of an LLM response (tolerates code fences / prose). */
function extractPlanJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const starts = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  return JSON.parse(end >= start ? t.slice(start, end + 1) : t);
}

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

  // 1. Decompose (LLM) → validate into a sound plan.
  const llm = await callLLM({
    intent: "synthesize",
    system: buildPlannerPrompt(goal, ALL_DEPTS),
    messages: [{ role: "user", content: `Plan this goal: ${goal}` }],
  });
  if (!llm.ok) return Response.json({ error: "planner_unavailable" }, { status: 502 });

  let plan;
  try {
    plan = parsePlan(extractPlanJson(llm.text), goal, ALL_DEPTS);
  } catch (err) {
    return Response.json({ error: "plan_invalid", detail: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }

  // 2. Materialize onto the execution substrate.
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
  // steps), so we can create in order and resolve index→id as we go.
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

  return Response.json({ ok: true, workflowId, steps: plan.steps, taskCount: plan.steps.length });
}
