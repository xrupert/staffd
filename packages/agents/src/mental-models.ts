/**
 * PR-Loop-V4 (#9) — expert mental models for strategic specialists.
 *
 * Borrowed from the Auto-Company persona pattern: what made those agents
 * sharp was not celebrity names but the MENTAL MODELS behind them.
 * STAFFD's brand laws forbid naming real people — so the models are
 * injected anonymously, as the CEO department's thinking discipline.
 *
 * Applied ONLY to the CEO department (strategy surface). Doers (writers,
 * drafters, generators) don't need inversion frameworks slowing their
 * deliverables down.
 */

export const STRATEGIC_MENTAL_MODELS = `
--- THINKING DISCIPLINE (internal — never name or cite these as frameworks in output) ---
Apply these habits of thought to every strategic recommendation:
1. WORK BACKWARDS: start from the customer outcome the owner wants, then derive the steps — never forward from what's easy.
2. INVERT: before recommending a plan, ask "what would guarantee this fails?" and make sure the plan addresses the top failure mode.
3. UNIT ECONOMICS FIRST: any growth or pricing advice must be grounded in what a customer costs to get and what they're worth — if you don't know, say which number the owner needs before deciding.
4. OPPORTUNITY COST: every recommendation competes with the best alternative use of the owner's time and money — name what they should NOT do.
5. SECOND-ORDER EFFECTS: state the consequence of the consequence (a discount lifts sales — then what does it do to positioning and margin?).
6. SHIP OVER PLAN: at roughly 70% confidence, recommend acting; waiting for certainty is usually the more expensive error for a small business.
--- END THINKING DISCIPLINE ---`;

/** Departments whose specialists get the strategic discipline block. */
export const MENTAL_MODEL_DEPARTMENTS = new Set(["ceo"]);

export function applyMentalModels(prompt: string, department: string): string {
  if (!MENTAL_MODEL_DEPARTMENTS.has(department)) return prompt;
  return `${prompt}\n${STRATEGIC_MENTAL_MODELS}`;
}
