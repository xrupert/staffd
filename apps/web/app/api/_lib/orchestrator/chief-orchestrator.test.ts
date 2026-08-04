import { describe, expect, it, vi } from "vitest";
import { executeMission } from "./chief-orchestrator";
import { planMission } from "./mission-control";

describe("executeMission", () => {
  it("executes architecture before dependent capabilities", async () => {
    const plan = planMission({
      goal: "Create a viral video and measure conversions",
      requestedBy: "customer-1",
    });
    const order: string[] = [];
    const pass = vi.fn(async (step: { capability: string }) => {
      order.push(step.capability);
      return { output: "done", passed: true };
    });

    const report = await executeMission(
      plan,
      {
        business_architecture: pass,
        marketing: pass,
        content: pass,
        analytics: pass,
      },
      { missionId: plan.id, customerId: "customer-1", correlationId: "corr-1" },
    );

    expect(order[0]).toBe("business_architecture");
    expect(report.completedStepIds).toHaveLength(plan.steps.length);
    expect(report.escalatedStepIds).toEqual([]);
  });

  it("runs a bounded repair attempt", async () => {
    const plan = planMission({ goal: "Create a marketing campaign", requestedBy: "customer-1" });
    let calls = 0;

    const report = await executeMission(
      plan,
      {
        business_architecture: async () => ({ output: "plan", passed: true }),
        marketing: async () => {
          calls += 1;
          return calls === 1
            ? { output: "weak draft", passed: false, failureFingerprint: "weak-hook" }
            : { output: "approved campaign", passed: true };
        },
      },
      { missionId: plan.id, customerId: "customer-1", correlationId: "corr-2" },
    );

    expect(calls).toBe(2);
    expect(report.escalatedStepIds).toEqual([]);
    expect(report.events.some((event) => event.type === "step_repairing")).toBe(true);
  });

  it("escalates a capability that has no registered handler", async () => {
    const plan = planMission({ goal: "Review a legal contract", requestedBy: "customer-1" });

    const report = await executeMission(
      plan,
      { business_architecture: async () => ({ output: "plan", passed: true }) },
      { missionId: plan.id, customerId: "customer-1", correlationId: "corr-3" },
    );

    expect(report.escalatedStepIds).toContain(
      plan.steps.find((step) => step.capability === "legal")?.id,
    );
  });
});
