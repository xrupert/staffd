import { describe, expect, it } from "vitest";
import {
  approveMissionOutcomeForLearning,
  createMissionOutcome,
  missionOutcomeDelta,
} from "./mission-memory";

function outcome() {
  return createMissionOutcome({
    ownerId: "owner-1",
    missionId: "mission-1",
    hypothesis: "A shorter qualification flow will improve completion.",
    expectedOutcome: "Completion rate reaches 70%.",
    actualOutcome: "Completion rate reached 76%.",
    status: "success",
    metrics: [{ name: "Completion rate", expected: 70, actual: 76, unit: "%" }],
    evidence: [" analytics:experiment-1 ", "analytics:experiment-1", "crm:cohort-1"],
    lesson: "The shorter flow improved completion for this cohort.",
    confidenceBefore: 0.55,
    confidenceAfter: 0.8,
    observedAt: "2026-08-09T12:00:00Z",
  });
}

describe("mission memory outcome ledger", () => {
  it("creates normalized, evidence-deduplicated observations that are not approved learning", () => {
    const record = outcome();
    expect(record.ownerId).toBe("owner-1");
    expect(record.observedAt).toBe("2026-08-09T12:00:00.000Z");
    expect(record.evidence).toEqual(["analytics:experiment-1", "crm:cohort-1"]);
    expect(record.approvedForLearning).toBe(false);
    expect(record.approvedBy).toBeNull();
    expect(record.approvedAt).toBeNull();
  });

  it("computes actual minus expected metric deltas and preserves unknown deltas", () => {
    const record = createMissionOutcome({
      ...outcome(),
      id: undefined,
      metrics: [
        { name: "Qualified leads", expected: 20, actual: 27 },
        { name: "Retention", expected: null, actual: 84, unit: "%" },
      ],
    });
    expect(missionOutcomeDelta(record)).toEqual({ "Qualified leads": 7, Retention: null });
  });

  it("requires valid confidence, timestamps, and finite metric values", () => {
    expect(() => createMissionOutcome({ ...outcome(), id: undefined, confidenceAfter: 1.2 })).toThrow(/between 0 and 1/);
    expect(() => createMissionOutcome({ ...outcome(), id: undefined, observedAt: "not-a-date" })).toThrow(/timestamp/);
    expect(() => createMissionOutcome({ ...outcome(), id: undefined, metrics: [{ name: "Revenue", actual: Number.NaN }] })).toThrow(/finite/);
  });

  it("requires evidence and a conclusive result before learning approval", () => {
    const noEvidence = createMissionOutcome({ ...outcome(), id: undefined, evidence: [] });
    expect(() => approveMissionOutcomeForLearning(noEvidence, "owner-1", "2026-08-09T13:00:00Z")).toThrow(/require evidence/);

    const inconclusive = createMissionOutcome({ ...outcome(), id: undefined, status: "inconclusive" });
    expect(() => approveMissionOutcomeForLearning(inconclusive, "owner-1", "2026-08-09T13:00:00Z")).toThrow(/Inconclusive/);
  });

  it("records explicit learning approval without mutating the original observation", () => {
    const record = outcome();
    const approved = approveMissionOutcomeForLearning(record, "owner-1", "2026-08-09T13:00:00Z");
    expect(record.approvedForLearning).toBe(false);
    expect(approved).toMatchObject({
      approvedForLearning: true,
      approvedBy: "owner-1",
      approvedAt: "2026-08-09T13:00:00.000Z",
    });
  });
});
