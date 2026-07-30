/**
 * Loop layer — plan critic (PR-Loop-V1, upgrade map #3, "the Munger").
 *
 * A customer-invisible adversarial reviewer that pre-mortems every L4
 * plan BETWEEN generation and presentation for approval. Pattern from
 * Auto-Company's critic-munger + Arch Spec #20's verification node:
 * never let the planner verify its own output.
 *
 * Hard constraints (ratified):
 *   - Veto/amend only, CANNOT stall: exactly one critic pass, and every
 *     failure mode (LLM down, junk output, invalid amendment) passes the
 *     ORIGINAL plan through unchanged. The critic can only ever improve.
 *   - Customer-invisible: concerns surface as coordinator-voiced notes,
 *     never as "an AI reviewed this".
 *
 * Pure module: prompt builder + response parser. The plan route owns the
 * single LLM call (same synthesize-policy piggyback as the planner —
 * no new SDK site, no intent-union ripple).
 */

import type { Plan } from "../orchestrator/planner";

export type Critique = {
  verdict: "approve" | "amend" | "unavailable";
  /** Coordinator-voiced concern lines (may be empty on approve). */
  concerns: string[];
  /** Present only when verdict === "amend": the improved steps, already
   *  re-validated through parsePlan by the caller before use. */
  amendedStepsRaw?: unknown;
};

export function buildCriticPrompt(plan: Plan, departments: readonly string[]): string {
  return [
    "You are STAFFD's plan reviewer — an adversarial pre-mortem specialist. A workflow plan is about to be proposed to a business owner. Your job is to find what is WRONG with it before they see it. Assume the plan fails; explain why it failed.",
    "",
    `GOAL: ${plan.goal}`,
    "",
    "PROPOSED PLAN (step index: department — task):",
    ...plan.steps.map((s, i) => `${i}: ${s.department} — ${s.task}${s.dependsOn.length ? ` (needs: ${s.dependsOn.join(",")})` : ""}`),
    "",
    "Audit for exactly these failure classes:",
    "1. A step assigned to the WRONG department for the work described.",
    "2. A missing step without which the goal cannot actually be achieved.",
    "3. Redundant or padding steps that spend the owner's budget without adding value.",
    "4. Dependency errors — a step that needs another step's output but doesn't declare it.",
    `Allowed departments (exact ids): ${departments.join(", ")}`,
    "",
    "Decision rules:",
    "- If the plan is sound, verdict is \"approve\" (minor quibbles are NOT amendments).",
    "- Amend ONLY for a failure from the classes above. Keep amendments minimal — never grow the plan beyond what the goal needs.",
    "- Concerns must be phrased as a helpful coordinator would say them to the owner (no mention of reviews, audits, or AI).",
    "",
    'Respond with ONLY this JSON (no prose, no code fence): {"verdict":"approve"|"amend","concerns":["<short note>", ...],"steps":[{"department":"<id>","task":"<what to produce>","dependsOn":[<int>,...]}]} — include "steps" ONLY when verdict is "amend".',
  ].join("\n");
}

/** Parse the critic's untrusted JSON. Any shape violation → approve-shaped
 *  passthrough (the critic can never stall or damage a plan). */
export function parseCritique(raw: unknown): Critique {
  if (!raw || typeof raw !== "object") return { verdict: "approve", concerns: [] };
  const o = raw as { verdict?: unknown; concerns?: unknown; steps?: unknown };
  const verdict = o.verdict === "amend" ? "amend" : "approve";
  const concerns = Array.isArray(o.concerns)
    ? o.concerns.map((c) => String(c)).filter((c) => c.trim().length > 0).slice(0, 5)
    : [];
  if (verdict === "amend" && o.steps !== undefined) {
    return { verdict, concerns, amendedStepsRaw: o.steps };
  }
  // "amend" without steps carries no actionable change — degrade to approve
  // but keep the concerns as advisory notes.
  return { verdict: "approve", concerns };
}
