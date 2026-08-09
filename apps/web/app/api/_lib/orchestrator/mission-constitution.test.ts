import { describe, expect, it } from "vitest";
import type { MissionRecord } from "./mission-repository";
import { evaluateMissionStartConstitution } from "./mission-constitution";

function mission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "mission-1",
    user: "owner-1",
    outcome_id: "run_a_campaign",
    goal: "Launch a campaign",
    status: "planned",
    risk: "medium",
    budget_credits: 20,
    approval_required: false,
    workflow_id: "",
    plan: {
      id: "plan-1",
      goal: "Launch a campaign",
      requestedBy: "owner-1",
      status: "planned",
      risk: "medium",
      budgetCredits: 20,
      constraints: [],
      successCriteria: ["Campaign is delivered and verified"],
      steps: [],
      inversionReviewed: true,
      failureModes: [],
    },
    evidence: [],
    correlation_id: "corr-1",
    ...overrides,
  } as MissionRecord;
}

describe("mission Constitution gate", () => {
  it("allows a planned mission only after inversion has been reviewed", () => {
    expect(evaluateMissionStartConstitution(mission())).toEqual({ allowed: true, violations: [] });
  });

  it("blocks legacy or malformed missions that never completed inversion", () => {
    const verdict = evaluateMissionStartConstitution(mission({
      plan: { ...mission().plan, inversionReviewed: false },
    }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map((item) => item.code)).toContain("inversion_required");
  });

  it("blocks approval-gated work unless the mission has reached the approved planned state", () => {
    const verdict = evaluateMissionStartConstitution(mission({
      approval_required: true,
      status: "waiting_for_approval",
    }));
    expect(verdict.violations.map((item) => item.code)).toContain("approval_required");
  });

  it("blocks a missing tenant owner even when other mission fields look executable", () => {
    const verdict = evaluateMissionStartConstitution(mission({ user: "" }));
    expect(verdict.violations.map((item) => item.code)).toContain("tenant_boundary_unverified");
  });

  it("treats critical missions as high-impact constitutional work", () => {
    const verdict = evaluateMissionStartConstitution(mission({
      risk: "critical",
      approval_required: true,
      status: "waiting_for_approval",
    }));
    expect(verdict.violations.map((item) => item.code)).toContain("approval_required");
  });
});
