import { describe, expect, it } from "vitest";
import { createMissionOutcome } from "./mission-memory";
import { fromStoredMissionOutcome, toStoredMissionOutcome } from "./mission-memory-store";

describe("mission memory storage mapping", () => {
  it("round-trips the immutable mission outcome record without losing learning state", () => {
    const record = createMissionOutcome({
      ownerId: "owner-1",
      missionId: "mission-1",
      hypothesis: "Tuesday sends will improve opens.",
      expectedOutcome: "Open rate reaches 35%.",
      actualOutcome: "Open rate reached 39%.",
      status: "success",
      metrics: [{ name: "Open rate", expected: 35, actual: 39, unit: "%" }],
      evidence: ["listmonk:campaign-42"],
      lesson: "Tuesday morning outperformed the baseline for this audience.",
      confidenceBefore: 0.5,
      confidenceAfter: 0.72,
      observedAt: "2026-08-09T12:00:00Z",
    });

    expect(fromStoredMissionOutcome(toStoredMissionOutcome(record))).toEqual(record);
  });
});
