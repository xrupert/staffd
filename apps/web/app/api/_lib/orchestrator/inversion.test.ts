import { describe, expect, it } from "vitest";
import { planMission } from "./mission-control";
import { buildFailureLedger, invertMissionPlan, validateFailureLedger } from "./inversion";

describe("mission inversion", () => {
  it("covers every mission capability with an executable failure mode", () => {
    const base = planMission({
      goal: "Create and publish a compliant sales campaign, follow up with leads, and measure revenue",
      requestedBy: "owner-1",
    });
    const plan = invertMissionPlan(base);
    const capabilities = [...new Set(plan.steps.map((step) => step.capability))];

    expect(plan.inversionReviewed).toBe(true);
    expect(validateFailureLedger(capabilities, plan.failureModes)).toEqual([]);
    expect(new Set(plan.failureModes.map((mode) => mode.capability))).toEqual(new Set(capabilities));
  });

  it("raises severity and likelihood for high-risk missions", () => {
    const ledger = buildFailureLedger(["business_architecture", "legal", "finance"], "high");

    expect(ledger.every((mode) => mode.likelihood === "high")).toBe(true);
    expect(ledger.find((mode) => mode.capability === "legal")?.severity).toBe("high");
    expect(ledger.find((mode) => mode.capability === "finance")?.killCriterion).toContain("Do not post");
  });

  it("requires warning, prevention, recovery, and kill criteria", () => {
    const ledger = buildFailureLedger(["marketing"], "medium");
    const broken = [{ ...ledger[0]!, killCriterion: "" }];

    expect(validateFailureLedger(["marketing"], broken)).toEqual([
      "failure-marketing-1 is missing a kill criterion",
    ]);
  });

  it("frames analytics failure around false success rather than missing activity", () => {
    const [mode] = buildFailureLedger(["analytics"], "low");

    expect(mode?.failure).toContain("vanity metrics");
    expect(mode?.preventiveControl).toContain("baseline");
    expect(mode?.killCriterion).toContain("selection bias");
  });
});
