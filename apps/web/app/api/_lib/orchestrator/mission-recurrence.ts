import type { MissionRecord } from "./mission-repository";

export type MissionRecurrence = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  timezone: "UTC";
};

const DAY_MS = 86_400_000;

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeMissionRecurrence(value: unknown): MissionRecurrence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MissionRecurrence>;
  if (!candidate.frequency || !["daily", "weekly", "monthly"].includes(candidate.frequency)) return null;
  const interval = Math.floor(candidate.interval ?? 1);
  if (interval < 1 || interval > 365) return null;
  if (candidate.timezone && candidate.timezone !== "UTC") return null;
  return { frequency: candidate.frequency, interval, timezone: "UTC" };
}

export function nextMissionRunAt(from: string | Date, recurrence: MissionRecurrence): string {
  const current = typeof from === "string" ? new Date(from) : new Date(from);
  if (!Number.isFinite(current.getTime())) throw new Error("A valid recurrence anchor is required");

  if (recurrence.frequency === "daily") {
    return new Date(current.getTime() + recurrence.interval * DAY_MS).toISOString();
  }
  if (recurrence.frequency === "weekly") {
    return new Date(current.getTime() + recurrence.interval * 7 * DAY_MS).toISOString();
  }

  const year = current.getUTCFullYear();
  const month = current.getUTCMonth() + recurrence.interval;
  const day = current.getUTCDate();
  const target = new Date(Date.UTC(
    year,
    month,
    1,
    current.getUTCHours(),
    current.getUTCMinutes(),
    current.getUTCSeconds(),
    current.getUTCMilliseconds(),
  ));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

export function recurringMissionIsDue(mission: MissionRecord, now = new Date()): boolean {
  if (!mission.recurrence_enabled || !normalizeMissionRecurrence(mission.recurrence)) return false;
  const nextRun = validDate(mission.next_run_at);
  return Boolean(nextRun && nextRun.getTime() <= now.getTime());
}

export function recurringOccurrenceCorrelationId(mission: MissionRecord): string {
  if (!mission.next_run_at) throw new Error("Recurring mission has no next run");
  return `${mission.correlation_id}:run:${new Date(mission.next_run_at).toISOString()}`;
}

export function recurringOccurrenceBody(mission: MissionRecord) {
  const correlationId = recurringOccurrenceCorrelationId(mission);
  return {
    user: mission.user,
    outcome_id: mission.outcome_id,
    goal: mission.goal,
    status: mission.approval_required ? "waiting_for_approval" : "planned",
    risk: mission.risk,
    budget_credits: mission.budget_credits,
    approval_required: mission.approval_required,
    workflow_id: "",
    plan: { ...mission.plan, id: correlationId, status: "planned" as const },
    evidence: mission.evidence,
    pending_events: [],
    correlation_id: correlationId,
    recurrence_enabled: false,
    recurrence: null,
    next_run_at: null,
    recurrence_last_run_at: null,
    recurrence_parent_id: mission.id,
  };
}

export function advanceRecurringMission(mission: MissionRecord): {
  next_run_at: string;
  recurrence_last_run_at: string;
} {
  const recurrence = normalizeMissionRecurrence(mission.recurrence);
  if (!recurrence || !mission.next_run_at) throw new Error("Recurring mission schedule is invalid");
  const dueAt = new Date(mission.next_run_at).toISOString();
  return {
    recurrence_last_run_at: dueAt,
    next_run_at: nextMissionRunAt(dueAt, recurrence),
  };
}
