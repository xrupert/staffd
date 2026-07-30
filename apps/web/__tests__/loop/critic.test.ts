/**
 * PR-Loop-V1 (#3) — plan critic: parseCritique is the trust boundary and
 * every malformed shape degrades to approve-passthrough (the critic can
 * improve a plan, never stall or damage one).
 */

import { describe, it, expect } from "vitest";
import { buildCriticPrompt, parseCritique } from "../../app/api/_lib/loop/critic";
import type { Plan } from "../../app/api/_lib/orchestrator/planner";

const PLAN: Plan = {
  goal: "Launch the spring promotion",
  steps: [
    { department: "marketing", task: "Draft campaign copy", dependsOn: [] },
    { department: "design", task: "Produce hero visual", dependsOn: [0] },
  ],
};

describe("parseCritique", () => {
  it("approve verdict with concerns", () => {
    expect(parseCritique({ verdict: "approve", concerns: ["Consider timing"] })).toEqual({
      verdict: "approve",
      concerns: ["Consider timing"],
    });
  });

  it("amend verdict carries the raw steps for re-validation", () => {
    const steps = [{ department: "marketing", task: "x", dependsOn: [] }];
    const c = parseCritique({ verdict: "amend", concerns: ["Missing legal review"], steps });
    expect(c.verdict).toBe("amend");
    expect(c.amendedStepsRaw).toBe(steps);
  });

  it("amend WITHOUT steps degrades to approve, keeping concerns as advisory", () => {
    const c = parseCritique({ verdict: "amend", concerns: ["Vague"] });
    expect(c.verdict).toBe("approve");
    expect(c.concerns).toEqual(["Vague"]);
    expect(c.amendedStepsRaw).toBeUndefined();
  });

  it("junk shapes degrade to approve-passthrough", () => {
    expect(parseCritique(null)).toEqual({ verdict: "approve", concerns: [] });
    expect(parseCritique("nonsense")).toEqual({ verdict: "approve", concerns: [] });
    expect(parseCritique({ verdict: "destroy" })).toEqual({ verdict: "approve", concerns: [] });
  });

  it("caps concerns at 5 and drops empties", () => {
    const c = parseCritique({ verdict: "approve", concerns: ["a", "", "b", "c", "d", "e", "f"] });
    expect(c.concerns).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("buildCriticPrompt", () => {
  it("is adversarial, indexes the steps, and forbids AI-mentions in concerns", () => {
    const p = buildCriticPrompt(PLAN, ["marketing", "design"]);
    expect(p).toContain("pre-mortem");
    expect(p).toContain("0: marketing — Draft campaign copy");
    expect(p).toContain("1: design — Produce hero visual (needs: 0)");
    expect(p).toContain("no mention of reviews, audits, or AI");
  });
});
