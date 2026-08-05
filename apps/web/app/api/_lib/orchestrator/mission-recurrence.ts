import type { MissionRecord } from "./mission-repository";

export type MissionRecurrence = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  timezone: string;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function zonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
    millisecond: date.getUTCMilliseconds(),
  };
}

function wallClockAsUtc(parts: ZonedDateParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  return wallClockAsUtc(zonedDateParts(date, timezone)) - date.getTime();
}

function zonedDateToUtc(parts: ZonedDateParts, timezone: string): Date {
  const wallClock = wallClockAsUtc(parts);
  let candidate = new Date(wallClock);

  // Timezone offsets can change between the anchor and target because of DST.
  // Two correction passes are sufficient for IANA zones and keep the requested
  // wall-clock time stable across those offset boundaries.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const corrected = new Date(wallClock - timezoneOffsetMs(candidate, timezone));
    if (corrected.getTime() === candidate.getTime()) break;
    candidate = corrected;
  }
  return candidate;
}

function addCalendarDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate(),
  };
}

function addCalendarMonths(parts: ZonedDateParts, months: number): ZonedDateParts {
  const target = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    ...parts,
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: Math.min(parts.day, lastDay),
  };
}

export function normalizeMissionRecurrence(value: unknown): MissionRecurrence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MissionRecurrence>;
  if (!candidate.frequency || !["daily", "weekly", "monthly"].includes(candidate.frequency)) return null;
  const interval = Math.floor(candidate.interval ?? 1);
  if (interval < 1 || interval > 365) return null;
  const timezone = candidate.timezone ?? "UTC";
  if (!validTimezone(timezone)) return null;
  return { frequency: candidate.frequency, interval, timezone };
}

export function nextMissionRunAt(from: string | Date, recurrence: MissionRecurrence): string {
  const current = typeof from === "string" ? new Date(from) : new Date(from);
  if (!Number.isFinite(current.getTime())) throw new Error("A valid recurrence anchor is required");
  if (!validTimezone(recurrence.timezone)) throw new Error("A valid IANA timezone is required");

  const currentLocal = zonedDateParts(current, recurrence.timezone);
  const nextLocal = recurrence.frequency === "monthly"
    ? addCalendarMonths(currentLocal, recurrence.interval)
    : addCalendarDays(currentLocal, recurrence.interval * (recurrence.frequency === "weekly" ? 7 : 1));

  return zonedDateToUtc(nextLocal, recurrence.timezone).toISOString();
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
