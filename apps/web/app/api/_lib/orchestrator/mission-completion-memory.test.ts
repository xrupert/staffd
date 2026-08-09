import { describe, expect, it } from "vitest";
import type { MissionRecord } from "./mission-repository";
import { missionCompletionObservation } from "./mission-completion-memory";

const mission: MissionRecord = {
  id: "mission-1",
  user: "owner-1",
  outcome_id: "launch-email-campaign",
  goal: "Launch a campaign and improve qualified leads",
  status: "running",
  risk: "medium",
  budget_credits: 20,
  approval_required: false,
  workflow_id: "workflow-1",
  plan: {
    id: "plan-1",
    goal: "Launch a campaign and improve qualified leads",
    requestedBy: "owner-1",
    status: "planned",
    risk: "medium",
    budgetCredits: 20,
    constraints: [],
    successCriteria: ["Campaign is delivered", "Qualified leads improve"],
    steps: [],
    inversionReviewed: true,
    failureModes: [],
  },
  evidence: [],
  correlation_id: "corr-1",
};

describe("mission completion memory", () => {
  it("records verified execution as inconclusive business impact", () => {
    const record = missionCompletionObservation(mission, [
      { id: "task-1", status: "succeeded", input_payload: { mission_step_id: "step-1" } },
      { id: "task-2", status: "succeeded", input_payload: { mission_step_id: "step-2" } },
    ], "2026-08-09T12:00:00Z");

    expect(record.status).toBe("inconclusive");
    expect(record.actualOutcome).toContain("business outcome has not yet been independently measured");
    expect(record.approvedForLearning).toBe(false);
    expect(record.evidence).toEqual([
      "mission:mission-1",
      "workflow:workflow-1",
      "workflow_task:task-1",
      "workflow_task:task-2",
    ]);
  });

  it("refuses to create completion memory before every task succeeds", () => {
    expect(() => missionCompletionObservation(mission, [
      { id: "task-1", status: "succeeded" },
      { id: "task-2", status: "running" },
    ], "2026-08-09T12:00:00Z")).toThrow(/all workflow tasks to succeed/);
  });
});
