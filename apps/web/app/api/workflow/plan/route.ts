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
 * Tranche-2 debt (surfaced, reprioritized): the LLM call piggybacks the
 * orchestrator "synthesize" intent/policy (no new SDK site, no
 * Record<OrchestratorIntent> ripple, and crucially no friction in the orchestrator
 * handler-dispatch switch where a planner does not belong). A dedicated `plan`
 * telemetry label for cost attribution (#33) is deferred until the planner has
 * real traffic to attribute. Live decomposition quality is operator-verified
 * (OPERATOR_TEST_QUEUE).
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { callLLM } from "../../_lib/orchestrator/llm";
import { buildPlannerPrompt, parsePlan, ALL_DEPTS, type Plan } from "../../_lib/orchestrator/planner";
import { buildCriticPrompt, parseCritique, type Critique } from "../../_lib/loop/critic";

/** Pull the JSON object/array out of an LLM response (tolerates code fences / prose). */
export function extractPlanJson(text: string): unknown {
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

  const llm = await callLLM({
    intent: "synthesize",
    system: buildPlannerPrompt(goal, ALL_DEPTS),
    messages: [{ role: "user", content: `Plan this goal: ${goal}` }],
  });
  if (!llm.ok) return Response.json({ error: "planner_unavailable" }, { status: 502 });

  let plan: Plan;
  try {
    plan = parsePlan(extractPlanJson(llm.text), goal, ALL_DEPTS);
  } catch (err) {
    return Response.json({ error: "plan_invalid", detail: err instanceof Error ? err.message : String(err) }, { status: 422 });
  }

  // PR-Loop-V1 (#3) — the critic pre-mortems the plan before the owner
  // sees it. Exactly one pass; every failure mode passes the ORIGINAL
  // plan through (the critic can improve, never stall). Amended steps
  // are re-validated through parsePlan — the same trust boundary as the
  // planner's own output.
  const critique = await critiquePlan(plan);
  if (critique.verdict === "amend" && critique.amendedStepsRaw !== undefined) {
    try {
      plan = parsePlan(critique.amendedStepsRaw, goal, ALL_DEPTS);
    } catch {
      critique.verdict = "approve"; // invalid amendment → original plan stands
      delete critique.amendedStepsRaw;
    }
  }

  return Response.json({
    ok: true,
    goal,
    plan,
    steps: plan.steps,
    critique: { verdict: critique.verdict, concerns: critique.concerns },
  });
}

async function critiquePlan(plan: Plan): Promise<Critique> {
  try {
    const llm = await callLLM({
      intent: "synthesize",
      system: buildCriticPrompt(plan, ALL_DEPTS),
      messages: [{ role: "user", content: "Audit this plan." }],
    });
    if (!llm.ok) return { verdict: "unavailable", concerns: [] };
    return parseCritique(extractPlanJson(llm.text));
  } catch {
    return { verdict: "unavailable", concerns: [] };
  }
}
