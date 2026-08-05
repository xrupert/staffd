import { describe, expect, it } from "vitest";
import {
  harnessPolicyFor,
  inferMissionCapabilities,
  missionRequiresOutboundApproval,
  nextLoopDecision,
  planMission,
  validateExecutionGraph,
} from "./mission-control";

describe("mission control", () => {
  it("turns a plain-language business request into a dependency-aware capability plan", () => {
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
    const architecture = plan.steps.find((step) => step.capability === "business_architecture")!;
    const marketing = plan.steps.find((step) => step.capability === "marketing")!;
    const content = plan.steps.find((step) => step.capability === "content")!;
    const analytics = plan.steps.find((step) => step.capability === "analytics")!;

    expect(marketing.dependsOn).toEqual([architecture.id]);
    expect(content.dependsOn).toEqual([marketing.id]);
    expect(analytics.dependsOn).toEqual([marketing.id, content.id]);
    expect(marketing.approvalRequired).toBe(true);
    expect(content.approvalRequired).toBe(true);
    expect(validateExecutionGraph(plan.steps)).toEqual([]);
  });

  it("places legal review before outbound sales work", () => {
    const plan = planMission({
      goal: "Draft compliant outreach terms and send a proposal to a lead",
      requestedBy: "customer-1",
    });
    const legal = plan.steps.find((step) => step.capability === "legal")!;
    const sales = plan.steps.find((step) => step.capability === "sales")!;

    expect(plan.risk).toBe("high");
    expect(legal.approvalRequired).toBe(true);
    expect(sales.dependsOn).toContain(legal.id);
    expect(sales.approvalRequired).toBe(true);
  });

  it("only requires outbound approval when the request crosses the send boundary", () => {
    expect(missionRequiresOutboundApproval("Draft a campaign", "marketing")).toBe(false);
    expect(missionRequiresOutboundApproval("Publish the campaign", "marketing")).toBe(true);
    expect(missionRequiresOutboundApproval("Send a customer response", "customer_support")).toBe(true);
    expect(missionRequiresOutboundApproval("Send the weekly report", "analytics")).toBe(false);
  });

  it("makes analytics wait for all execution work", () => {
    const plan = planMission({
      goal: "Create a campaign, follow up with leads, coordinate delivery, and report performance",
      requestedBy: "customer-1",
    });
    const analytics = plan.steps.find((step) => step.capability === "analytics")!;
    const expectedDependencies = plan.steps
      .filter((step) => !["business_architecture", "analytics"].includes(step.capability))
      .map((step) => step.id);

    expect(analytics.dependsOn).toEqual(expectedDependencies);
    expect(validateExecutionGraph(plan.steps)).toEqual([]);
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
