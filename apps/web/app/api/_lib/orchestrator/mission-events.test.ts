import { describe, expect, it } from "vitest";
import { summarizeMissionTimeline, type MissionEventRecord } from "./mission-events";

function event(partial: Partial<MissionEventRecord>): MissionEventRecord {
  return {
    id: partial.id ?? crypto.randomUUID(),
    user: "user-1",
    mission: "mission-1",
    type: partial.type ?? "step_started",
    message: partial.message ?? "Working",
    ...partial,
  };
}

describe("summarizeMissionTimeline", () => {
  it("counts unique completed steps and accumulated cost", () => {
    const timeline = summarizeMissionTimeline(4, "running", [
      event({ type: "step_completed", step_id: "a", cost_credits: 2 }),
      event({ type: "step_completed", step_id: "a", cost_credits: 1 }),
      event({ type: "step_completed", step_id: "b", cost_credits: 3 }),
    ]);

    expect(timeline.completedSteps).toBe(2);
    expect(timeline.progressPercent).toBe(50);
    expect(timeline.spentCredits).toBe(6);
  });

  it("reports completed missions as fully complete", () => {
    expect(summarizeMissionTimeline(5, "completed", []).progressPercent).toBe(100);
  });

  it("never treats a failed mission as fully complete", () => {
    const events = [
      event({ type: "step_completed", step_id: "a" }),
      event({ type: "step_completed", step_id: "b" }),
    ];
    expect(summarizeMissionTimeline(2, "failed", events).progressPercent).toBe(99);
  });
});
