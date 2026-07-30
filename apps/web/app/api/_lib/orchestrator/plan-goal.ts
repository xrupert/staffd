/**
 * PR-Loop-V4 (#8) — goal → critiqued plan, extracted from the plan route
 * so BOTH entry points (owner-interactive /api/workflow/plan and the
 * recurring scheduled worker) run the identical pipeline: planner LLM →
 * parsePlan trust boundary → critic pre-mortem → validated amendment.
 */

import { callLLM } from "./llm";
import { buildPlannerPrompt, parsePlan, ALL_DEPTS, type Plan } from "./planner";
import { buildCriticPrompt, parseCritique, type Critique } from "../loop/critic";

/** Pull the JSON object/array out of an LLM response (tolerates code fences / prose). */
export function extractPlanJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const starts = ["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0);
  const start = starts.length ? Math.min(...starts) : 0;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  return JSON.parse(end >= start ? t.slice(start, end + 1) : t);
}

export class PlannerUnavailableError extends Error {
  constructor() {
    super("planner_unavailable");
    this.name = "PlannerUnavailableError";
  }
}

/** Generate + critique a plan for a goal. Throws PlannerUnavailableError
 *  when the planner LLM is down; throws plan_invalid errors from parsePlan
 *  when the model's plan is unsound. The critic can never throw — every
 *  critic failure mode passes the original plan through. */
export async function planGoal(goal: string): Promise<{ plan: Plan; critique: Critique }> {
  const llm = await callLLM({
    intent: "synthesize",
    system: buildPlannerPrompt(goal, ALL_DEPTS),
    messages: [{ role: "user", content: `Plan this goal: ${goal}` }],
  });
  if (!llm.ok) throw new PlannerUnavailableError();

  let plan = parsePlan(extractPlanJson(llm.text), goal, ALL_DEPTS);

  const critique = await critiquePlan(plan);
  if (critique.verdict === "amend" && critique.amendedStepsRaw !== undefined) {
    try {
      plan = parsePlan(critique.amendedStepsRaw, goal, ALL_DEPTS);
    } catch {
      critique.verdict = "approve"; // invalid amendment → original plan stands
      delete critique.amendedStepsRaw;
    }
  }
  return { plan, critique };
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
