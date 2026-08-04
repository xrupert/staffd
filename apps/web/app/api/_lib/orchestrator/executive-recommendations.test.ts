import { describe, expect, it } from "vitest";
import { recommendExecutiveActions } from "./executive-recommendations";

const now = new Date("2026-08-04T20:00:00.000Z");

describe("recommendExecutiveActions", () => {
  it("prioritizes approvals and repairs before routine work", () => {
    const recommendations = recommendExecutiveActions([
      { id: "planned", goal: "Launch a campaign", status: "planned", updated: now.toISOString() },
      { id: "repair", goal: "Prepare a contract", status: "repairing", updated: now.toISOString() },
      { id: "approval", goal: "Send a newsletter", status: "waiting_for_approval", updated: now.toISOString() },
    ], now);

    expect(recommendations.map((item) => item.priority)).toEqual(["critical", "critical", "normal"]);
    expect(recommendations.map((item) => item.missionId)).toContain("approval");
    expect(recommendations.map((item) => item.missionId)).toContain("repair");
  });

  it("flags running missions that have not changed for 24 hours", () => {
    const recommendations = recommendExecutiveActions([
      {
        id: "stalled",
        goal: "Follow up with warm leads",
        status: "running",
        updated: "2026-08-03T18:00:00.000Z",
        progress: { percent: 40, latestMessage: "Two tasks completed" },
      },
    ], now);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ priority: "high", missionId: "stalled" });
    expect(recommendations[0]?.evidence).toContain("40% complete");
  });

  it("does not flag recently active running work", () => {
    const recommendations = recommendExecutiveActions([
      { id: "active", goal: "Produce a video", status: "running", updated: "2026-08-04T19:30:00.000Z" },
    ], now);

    expect(recommendations).toEqual([]);
  });

  it("surfaces recently completed work for review", () => {
    const recommendations = recommendExecutiveActions([
      { id: "done", goal: "Review business performance", status: "completed", updated: "2026-08-04T12:00:00.000Z" },
    ], now);

    expect(recommendations[0]).toMatchObject({ missionId: "done", actionLabel: "Review the result" });
  });
});
