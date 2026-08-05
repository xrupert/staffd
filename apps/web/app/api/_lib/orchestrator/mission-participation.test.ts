import { describe, expect, it } from "vitest";
import type { MissionRecord } from "./mission-repository";
import { missionParticipationCard } from "./mission-participation";

function mission(status: MissionRecord["status"]): MissionRecord {
  return {
    id: "mission-1",
    user: "user-1",
    outcome_id: "custom" as MissionRecord["outcome_id"],
    goal: "Publish a campaign and follow up with leads",
    status,
    risk: "medium",
    budget_credits: 30,
    approval_required: true,
    plan: {
      id: "mission-1",
      goal: "Publish a campaign and follow up with leads",
      requestedBy: "user-1",
      status: "planned",
      risk: "medium",
      budgetCredits: 30,
      constraints: [],
      successCriteria: ["Campaign delivered"],
      steps: [
        {
          id: "step-1",
          title: "Design the campaign and audience strategy",
          capability: "marketing",
          dependsOn: [],
          approvalRequired: true,
          successCriteria: ["Campaign approved"],
          maxAttempts: 2,
        },
        {
          id: "step-2",
          title: "Measure results and verify the outcome",
          capability: "analytics",
          dependsOn: ["step-1"],
          approvalRequired: false,
          successCriteria: ["Results measured"],
          maxAttempts: 2,
        },
      ],
    },
    evidence: ["Published campaign URL"],
    correlation_id: "correlation-1",
  };
}

describe("missionParticipationCard", () => {
  it("describes exactly which approval-gated steps will proceed", () => {
    const card = missionParticipationCard(mission("waiting_for_approval"));

    expect(card?.kind).toBe("approval");
    expect(card?.scope).toEqual(["Design the campaign and audience strategy"]);
    expect(card?.primaryAction).toBe("approve");
    expect(card?.consequence).toContain("budgets");
  });

  it("shows the execution plan before a mission starts", () => {
    const card = missionParticipationCard(mission("planned"));

    expect(card?.kind).toBe("start");
    expect(card?.scope).toHaveLength(2);
    expect(card?.primaryAction).toBe("start");
  });

  it("preserves the durable plan when recovery is required", () => {
    const card = missionParticipationCard(mission("repairing"));

    expect(card?.kind).toBe("repair");
    expect(card?.primaryAction).toBe("resume");
    expect(card?.consequence).toContain("audit history");
  });

  it("does not interrupt running or completed missions", () => {
    expect(missionParticipationCard(mission("running"))).toBeNull();
    expect(missionParticipationCard(mission("completed"))).toBeNull();
  });
});
