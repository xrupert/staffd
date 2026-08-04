import { describe, expect, it } from "vitest";
import {
  harnessPolicyFor,
  inferMissionCapabilities,
  nextLoopDecision,
  planMission,
  validateExecutionGraph,
} from "./mission-control";

describe("mission control", () => {
  it("turns a plain-language business request into a capability plan", () => {
    const plan = planMission({
      goal: "Create a viral product video, publish the campaign, and measure conversions",
      requestedBy: "customer-1",
      successCriteria: ["Video approved", "Campaign published", "Conversions tracked"],
    });

    expect(inferMissionCapabilities(plan.goal)).toEqual([
      "business_architecture",
      "marketing",
      "content",
      "analytics",
    ]);
    expect(plan.steps[0]?.capability).toBe("business_architecture");
    expect(plan.steps.slice(1).every((step) => step.dependsOn.includes(plan.steps[0]!.id))).toBe(true);
    expect(validateExecutionGraph(plan.steps)).toEqual([]);
  });

  it("requires approval for legal work", () => {
    const plan = planMission({
      goal: "Review a customer contract and prepare a compliant response",
      requestedBy: "customer-1",
    });
    const legalStep = plan.steps.find((step) => step.capability === "legal");

    expect(plan.risk).toBe("high");
    expect(legalStep?.approvalRequired).toBe(true);
  });

  it("creates bounded harness policies", () => {
    const plan = planMission({ goal: "Create a marketing campaign", requestedBy: "customer-1" });
    const policy = harnessPolicyFor(plan.steps[1]!, plan);

    expect(policy.maxAttempts).toBeGreaterThan(0);
    expect(policy.maxCostCredits).toBeGreaterThan(0);
    expect(policy.allowedTools).toContain("pocketbase");
  });

  it("repairs a failed attempt and completes a passing attempt", () => {
    const plan = planMission({ goal: "Create a marketing campaign", requestedBy: "customer-1" });
    const policy = harnessPolicyFor(plan.steps[1]!, plan);

    expect(nextLoopDecision([{ attempt: 1, output: "draft", passed: false }], policy)).toEqual({
      action: "repair",
      nextAttempt: 2,
    });
    expect(nextLoopDecision([{ attempt: 1, output: "approved", passed: true }], policy)).toEqual({
      action: "complete",
    });
  });

  it("escalates repeated failures instead of looping forever", () => {
    const plan = planMission({ goal: "Create a marketing campaign", requestedBy: "customer-1" });
    const policy = harnessPolicyFor(plan.steps[1]!, plan);

    expect(
      nextLoopDecision(
        [
          { attempt: 1, output: "bad", passed: false, failureFingerprint: "missing-brand" },
          { attempt: 2, output: "still bad", passed: false, failureFingerprint: "missing-brand" },
        ],
        policy,
      ),
    ).toEqual({ action: "escalate", reason: "no_progress" });
  });

  it("rejects missing graph dependencies", () => {
    expect(
      validateExecutionGraph([
        {
          id: "publish",
          title: "Publish",
          capability: "marketing",
          dependsOn: ["approve"],
          approvalRequired: false,
          successCriteria: ["Published"],
          maxAttempts: 2,
        },
      ]),
    ).toEqual(["publish depends on missing step approve"]);
  });

  it("rejects cyclic execution graphs", () => {
    const shared = {
      title: "Step",
      capability: "operations" as const,
      approvalRequired: false,
      successCriteria: ["Done"],
      maxAttempts: 2,
    };

    expect(
      validateExecutionGraph([
        { ...shared, id: "a", dependsOn: ["b"] },
        { ...shared, id: "b", dependsOn: ["a"] },
      ]),
    ).toContain("Mission execution graph contains a cycle");
  });
});
