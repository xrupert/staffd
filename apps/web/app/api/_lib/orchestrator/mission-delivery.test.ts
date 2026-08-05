import { describe, expect, it } from "vitest";
import { buildMissionDeliveryPackage } from "./mission-delivery";
import type { MissionEventRecord } from "./mission-events";
import type { MissionRecord } from "./mission-repository";

function mission(status: MissionRecord["status"] = "completed"): MissionRecord {
  return {
    id: "mission-1",
    user: "user-1",
    outcome_id: "campaign_launch",
    goal: "Launch the campaign",
    status,
    risk: "medium",
    budget_credits: 30,
    approval_required: true,
    plan: {
      id: "plan-1",
      goal: "Launch the campaign",
      requestedBy: "user-1",
      status: "planned",
      risk: "medium",
      budgetCredits: 30,
      constraints: [],
      successCriteria: ["Campaign is delivered"],
      steps: [],
    },
    evidence: ["Published campaign URL", "Performance baseline"],
    correlation_id: "correlation-1",
    updated: "2026-08-05T02:00:00.000Z",
  };
}

function event(partial: Partial<MissionEventRecord>): MissionEventRecord {
  return {
    id: partial.id ?? "event-1",
    user: "user-1",
    mission: "mission-1",
    type: partial.type ?? "evidence_recorded",
    message: partial.message ?? "Evidence recorded",
    ...partial,
  };
}

describe("buildMissionDeliveryPackage", () => {
  it("returns null before completion", () => {
    expect(buildMissionDeliveryPackage(mission("running"), [])).toBeNull();
  });

  it("packages outcome, proof, artifacts, approvals, actions, and spend", () => {
    const delivery = buildMissionDeliveryPackage(mission(), [
      event({ id: "approved", type: "mission_approved", message: "Owner approved publishing." }),
      event({ id: "step", type: "step_completed", message: "Campaign content was created.", cost_credits: 7 }),
      event({
        id: "proof",
        type: "evidence_recorded",
        message: "Campaign proof recorded.",
        evidence: {
          published_url: "https://example.com/campaign",
          report_url: "https://example.com/report.pdf",
          metric: "Baseline captured",
        },
        cost_credits: 2,
      }),
      event({
        id: "complete",
        type: "mission_completed",
        message: "Campaign launched successfully.",
        created: "2026-08-05T01:00:00.000Z",
      }),
    ]);

    expect(delivery).not.toBeNull();
    expect(delivery?.outcome).toBe("Campaign launched successfully.");
    expect(delivery?.completedAt).toBe("2026-08-05T01:00:00.000Z");
    expect(delivery?.spentCredits).toBe(9);
    expect(delivery?.approvals).toEqual(["Owner approved publishing."]);
    expect(delivery?.actionsTaken).toEqual(["Campaign content was created."]);
    expect(delivery?.evidence).toContain("Baseline captured");
    expect(delivery?.artifacts.map((artifact) => artifact.href)).toEqual([
      "https://example.com/campaign",
      "https://example.com/report.pdf",
    ]);
  });

  it("deduplicates repeated artifacts and evidence", () => {
    const delivery = buildMissionDeliveryPackage(mission(), [
      event({ id: "proof-1", evidence: { url: "https://example.com/result", note: "Verified" } }),
      event({ id: "proof-2", evidence: { href: "https://example.com/result", note: "Verified" } }),
    ]);

    expect(delivery?.artifacts).toHaveLength(1);
    expect(delivery?.evidence.filter((item) => item === "Verified")).toHaveLength(1);
  });
});
