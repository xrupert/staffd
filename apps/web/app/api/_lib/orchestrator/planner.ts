/**
 * Workflow planner (W73 / L4) — PURE decomposition core. Turns a high-level goal
 * into a validated DAG of department tasks that the EXISTING execution substrate
 * runs unchanged: each plan step becomes a `workflow_tasks` row (department_id +
 * input_payload.task + depends_on), `drainTasks` executes the DAG honoring
 * dependencies, and `reconcileWorkflow` completes the parent. The planner adds no
 * execution — it is purely "goal → plan".
 *
 * parsePlan is the trust boundary: it converts untrusted LLM JSON into a
 * structurally-sound plan or throws. Invariants enforced:
 *   - 1..MAX_PLAN_STEPS steps
 *   - every step targets a routable department (injected — single source of truth)
 *   - every task is non-empty
 *   - dependsOn references EARLIER step indices only → the DAG is acyclic and
 *     already topologically ordered (so persistence can create rows in order).
 */

export const MAX_PLAN_STEPS = 12;

/**
 * Canonical routable department ids — the single source for routing + the L4
 * planner. Lives here (a pure, dependency-free module) so any route can import
 * it without dragging in the heavy orchestrator handler module.
 */
export const ALL_DEPTS = [
  "marketing", "sales", "legal", "hr", "finance", "operations", "paid-media", "design", "reputation", "ceo",
] as const;

export type PlanStep = { department: string; task: string; dependsOn: number[] };
export type Plan = { goal: string; steps: PlanStep[] };

export type TaskSeed = {
  stepIndex: number;
  department_id: string;
  input_payload: { task: string; goal: string };
  dependsOnSteps: number[];
};

function asSteps(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)) {
    return (raw as { steps: unknown[] }).steps;
  }
  throw new Error("plan_parse: expected an array of steps or { steps: [...] }");
}

/** Parse + validate untrusted plan JSON into a Plan, or throw a structured Error. */
export function parsePlan(raw: unknown, goal: string, validDepartments: readonly string[]): Plan {
  const rawSteps = asSteps(raw);
  if (rawSteps.length === 0) throw new Error("plan_invalid: a plan must have at least one step");
  if (rawSteps.length > MAX_PLAN_STEPS) throw new Error(`plan_invalid: too many steps (maximum ${MAX_PLAN_STEPS})`);

  const valid = new Set(validDepartments);
  const steps: PlanStep[] = rawSteps.map((s, i) => {
    if (!s || typeof s !== "object") throw new Error(`plan_invalid: step ${i} is not an object`);
    const dept = String((s as { department?: unknown }).department ?? "").trim();
    if (!valid.has(dept)) throw new Error(`plan_invalid: step ${i} targets an unknown department "${dept}"`);
    const task = String((s as { task?: unknown }).task ?? "").trim();
    if (!task) throw new Error(`plan_invalid: step ${i} has an empty task`);

    const depRaw = (s as { dependsOn?: unknown }).dependsOn ?? [];
    if (!Array.isArray(depRaw)) throw new Error(`plan_invalid: step ${i} dependsOn must be an array`);
    const seen = new Set<number>();
    const dependsOn = depRaw.map((d) => {
      const n = Number(d);
      if (!Number.isInteger(n) || n < 0 || n >= i) {
        throw new Error(`plan_invalid: step ${i} has an invalid dependency ${String(d)} (must reference an earlier step)`);
      }
      if (seen.has(n)) throw new Error(`plan_invalid: step ${i} has a duplicate dependency ${n}`);
      seen.add(n);
      return n;
    });
    return { department: dept, task, dependsOn };
  });

  return { goal: goal.trim(), steps };
}

/** Pure mapping: Plan → per-step task seeds (index-based deps; persistence resolves to ids). */
export function planToTaskSeeds(plan: Plan): TaskSeed[] {
  return plan.steps.map((s, i) => ({
    stepIndex: i,
    department_id: s.department,
    input_payload: { task: s.task, goal: plan.goal },
    dependsOnSteps: s.dependsOn,
  }));
}

/** Build the LLM prompt that asks for a decomposition plan as strict JSON. */
export function buildPlannerPrompt(goal: string, departments: readonly string[]): string {
  return [
    "You are STAFFD's workflow planner. Decompose the user's goal into an ordered, minimal plan of department tasks.",
    "",
    `GOAL: ${goal}`,
    "",
    `Allowed departments (use these exact ids): ${departments.join(", ")}`,
    "",
    "Rules:",
    `- Output 1 to ${MAX_PLAN_STEPS} steps. Fewer is better — only the steps genuinely needed.`,
    "- Each step is one concrete deliverable handled by one department.",
    "- `dependsOn` lists the indexes of EARLIER steps whose output this step needs (or [] if none).",
    "- Never reference a later or the same step. Steps must read top-to-bottom in execution order.",
    "",
    'Respond with ONLY this JSON (no prose, no code fence): {"steps":[{"department":"<id>","task":"<what to produce>","dependsOn":[<int>,...]}]}',
  ].join("\n");
}
