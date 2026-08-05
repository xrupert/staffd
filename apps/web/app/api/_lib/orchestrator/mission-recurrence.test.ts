import { describe, expect, it } from "vitest";
import type { MissionRecord } from "./mission-repository";
import {
  advanceRecurringMission,
  nextMissionRunAt,
  normalizeMissionRecurrence,
  recurringMissionIsDue,
  recurringOccurrenceBody,
} from "./mission-recurrence";

function mission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "schedule-1",
    user: "user-1",
    outcome_id: "custom" as MissionRecord["outcome_id"],
    goal: "Prepare the weekly operating brief",
    status: "completed",
    risk: "low",
    budget_credits: 10,
    approval_required: false,
    plan: {
      id: "plan-1",
      goal: "Prepare the weekly operating brief",
      requestedBy: "user-1",
      status: "planned",
      risk: "low",
      budgetCredits: 10,
      constraints: [],
      successCriteria: ["Brief delivered"],
      steps: [],
    },
    evidence: ["Brief URL"],
    correlation_id: "weekly-brief",
    recurrence_enabled: true,
    recurrence: { frequency: "weekly", interval: 1, timezone: "UTC" },
    next_run_at: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("mission recurrence", () => {
  it("normalizes bounded UTC schedules", () => {
    expect(normalizeMissionRecurrence({ frequency: "weekly", interval: 2 })).toEqual({
      frequency: "weekly",
      interval: 2,
      timezone: "UTC",
    });
    expect(normalizeMissionRecurrence({ frequency: "hourly", interval: 1 })).toBeNull();
    expect(normalizeMissionRecurrence({ frequency: "daily", interval: 0 })).toBeNull();
    expect(normalizeMissionRecurrence({ frequency: "daily", interval: 1, timezone: "America/New_York" })).toBeNull();
  });

  it("calculates daily, weekly, and month-end-safe next runs", () => {
    expect(nextMissionRunAt("2026-08-01T12:00:00.000Z", { frequency: "daily", interval: 2, timezone: "UTC" }))
      .toBe("2026-08-03T12:00:00.000Z");
    expect(nextMissionRunAt("2026-08-01T12:00:00.000Z", { frequency: "weekly", interval: 1, timezone: "UTC" }))
      .toBe("2026-08-08T12:00:00.000Z");
    expect(nextMissionRunAt("2026-01-31T12:00:00.000Z", { frequency: "monthly", interval: 1, timezone: "UTC" }))
      .toBe("2026-02-28T12:00:00.000Z");
  });

  it("detects only enabled due schedules", () => {
    expect(recurringMissionIsDue(mission(), new Date("2026-08-10T12:00:00.000Z"))).toBe(true);
    expect(recurringMissionIsDue(mission({ recurrence_enabled: false }), new Date("2026-08-11T12:00:00.000Z"))).toBe(false);
    expect(recurringMissionIsDue(mission({ next_run_at: "2026-08-12T12:00:00.000Z" }), new Date("2026-08-11T12:00:00.000Z"))).toBe(false);
  });

  it("creates an isolated occurrence and advances the parent exactly once", () => {
    const source = mission();
    const occurrence = recurringOccurrenceBody(source);
    expect(occurrence.correlation_id).toBe("weekly-brief:run:2026-08-10T12:00:00.000Z");
    expect(occurrence.recurrence_enabled).toBe(false);
    expect(occurrence.recurrence_parent_id).toBe(source.id);
    expect(advanceRecurringMission(source)).toEqual({
      recurrence_last_run_at: "2026-08-10T12:00:00.000Z",
      next_run_at: "2026-08-17T12:00:00.000Z",
    });
  });
});
