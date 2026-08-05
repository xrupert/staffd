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
  it("normalizes bounded schedules with valid IANA timezones", () => {
    expect(normalizeMissionRecurrence({ frequency: "weekly", interval: 2 })).toEqual({
      frequency: "weekly",
      interval: 2,
      timezone: "UTC",
    });
    expect(normalizeMissionRecurrence({
      frequency: "daily",
      interval: 1,
      timezone: "America/New_York",
    })).toEqual({
      frequency: "daily",
      interval: 1,
      timezone: "America/New_York",
    });
    expect(normalizeMissionRecurrence({ frequency: "hourly", interval: 1 })).toBeNull();
    expect(normalizeMissionRecurrence({ frequency: "daily", interval: 0 })).toBeNull();
    expect(normalizeMissionRecurrence({ frequency: "daily", interval: 1, timezone: "Not/A_Zone" })).toBeNull();
  });

  it("calculates daily, weekly, and month-end-safe UTC runs", () => {
    expect(nextMissionRunAt("2026-08-01T12:00:00.000Z", { frequency: "daily", interval: 2, timezone: "UTC" }))
      .toBe("2026-08-03T12:00:00.000Z");
    expect(nextMissionRunAt("2026-08-01T12:00:00.000Z", { frequency: "weekly", interval: 1, timezone: "UTC" }))
      .toBe("2026-08-08T12:00:00.000Z");
    expect(nextMissionRunAt("2026-01-31T12:00:00.000Z", { frequency: "monthly", interval: 1, timezone: "UTC" }))
      .toBe("2026-02-28T12:00:00.000Z");
  });

  it("preserves the local wall clock across daylight-saving changes", () => {
    expect(nextMissionRunAt("2026-03-07T14:00:00.000Z", {
      frequency: "daily",
      interval: 1,
      timezone: "America/New_York",
    })).toBe("2026-03-08T13:00:00.000Z");

    expect(nextMissionRunAt("2026-10-31T13:00:00.000Z", {
      frequency: "daily",
      interval: 1,
      timezone: "America/New_York",
    })).toBe("2026-11-01T14:00:00.000Z");
  });

  it("keeps month-end recurrence aligned to the owner's timezone", () => {
    expect(nextMissionRunAt("2026-01-31T14:30:00.000Z", {
      frequency: "monthly",
      interval: 1,
      timezone: "America/New_York",
    })).toBe("2026-02-28T14:30:00.000Z");
  });

  it("rejects invalid anchors and timezones", () => {
    expect(() => nextMissionRunAt("not-a-date", {
      frequency: "daily",
      interval: 1,
      timezone: "UTC",
    })).toThrow("A valid recurrence anchor is required");
    expect(() => nextMissionRunAt("2026-08-01T12:00:00.000Z", {
      frequency: "daily",
      interval: 1,
      timezone: "Bad/Timezone",
    })).toThrow("A valid IANA timezone is required");
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

  it("advances a local schedule without UTC drift", () => {
    expect(advanceRecurringMission(mission({
      recurrence: { frequency: "daily", interval: 1, timezone: "America/New_York" },
      next_run_at: "2026-03-07T14:00:00.000Z",
    }))).toEqual({
      recurrence_last_run_at: "2026-03-07T14:00:00.000Z",
      next_run_at: "2026-03-08T13:00:00.000Z",
    });
  });
});
