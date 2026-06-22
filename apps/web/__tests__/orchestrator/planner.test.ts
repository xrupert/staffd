/**
 * W73 (L4) — the workflow planner core. Decomposes a high-level goal into a
 * validated DAG of department tasks. The EXECUTION substrate already exists
 * (drainTasks runs the DAG, reconcileWorkflow completes the parent); the planner
 * is the missing brain. parsePlan is the load-bearing piece — it turns untrusted
 * LLM JSON into a structurally-sound plan or throws, so we never persist a bad
 * (cyclic / unroutable / empty) workflow.
 */

import { describe, it, expect } from "vitest";
import { parsePlan, planToTaskSeeds, buildPlannerPrompt, MAX_PLAN_STEPS } from "../../app/api/_lib/orchestrator/planner";

const DEPTS = ["marketing", "sales", "design", "legal"];
const ok = { steps: [
  { department: "marketing", task: "Draft launch copy", dependsOn: [] },
  { department: "design", task: "Create hero visual", dependsOn: [0] },
  { department: "sales", task: "Prep outreach using the copy + visual", dependsOn: [0, 1] },
] };

describe("parsePlan", () => {
  it("accepts a valid {steps} plan and carries the goal", () => {
    const plan = parsePlan(ok, "Launch the spring promo", DEPTS);
    expect(plan.goal).toBe("Launch the spring promo");
    expect(plan.steps.map((s) => s.department)).toEqual(["marketing", "design", "sales"]);
    expect(plan.steps[2]!.dependsOn).toEqual([0, 1]);
  });

  it("also accepts a bare steps array (LLM shape leniency)", () => {
    expect(parsePlan(ok.steps, "g", DEPTS).steps).toHaveLength(3);
  });

  it("rejects an unroutable department", () => {
    expect(() => parsePlan({ steps: [{ department: "accounting", task: "x", dependsOn: [] }] }, "g", DEPTS)).toThrow(/department/i);
  });

  it("rejects a forward/self dependency (keeps the DAG acyclic + topologically ordered)", () => {
    expect(() => parsePlan({ steps: [{ department: "marketing", task: "x", dependsOn: [1] }, { department: "sales", task: "y", dependsOn: [] }] }, "g", DEPTS)).toThrow(/depend/i);
    expect(() => parsePlan({ steps: [{ department: "marketing", task: "x", dependsOn: [0] }] }, "g", DEPTS)).toThrow(/depend/i);
  });

  it("rejects an empty plan and an over-long plan", () => {
    expect(() => parsePlan({ steps: [] }, "g", DEPTS)).toThrow(/empty|at least/i);
    const tooMany = { steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, () => ({ department: "marketing", task: "x", dependsOn: [] as number[] })) };
    expect(() => parsePlan(tooMany, "g", DEPTS)).toThrow(/too many|maximum/i);
  });

  it("rejects an empty task and a non-integer/out-of-range dependency", () => {
    expect(() => parsePlan({ steps: [{ department: "marketing", task: "   ", dependsOn: [] }] }, "g", DEPTS)).toThrow(/task/i);
    expect(() => parsePlan({ steps: [{ department: "marketing", task: "x", dependsOn: [] }, { department: "sales", task: "y", dependsOn: [5] }] }, "g", DEPTS)).toThrow(/depend/i);
  });
});

describe("planToTaskSeeds", () => {
  it("maps each step to a task seed carrying the goal + index-based deps", () => {
    const seeds = planToTaskSeeds(parsePlan(ok, "Launch", DEPTS));
    expect(seeds).toHaveLength(3);
    expect(seeds[1]).toMatchObject({ stepIndex: 1, department_id: "design", dependsOnSteps: [0] });
    expect(seeds[1]!.input_payload).toMatchObject({ task: "Create hero visual", goal: "Launch" });
  });
});

describe("buildPlannerPrompt", () => {
  it("includes the goal, the allowed departments, and asks for JSON", () => {
    const p = buildPlannerPrompt("Launch the promo", DEPTS);
    expect(p).toContain("Launch the promo");
    expect(p).toContain("marketing");
    expect(p.toLowerCase()).toContain("json");
  });
});
