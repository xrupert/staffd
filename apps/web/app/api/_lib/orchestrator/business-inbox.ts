export type InboxPriority = "critical" | "high" | "normal";
export type InboxKind = "approval" | "repair" | "booking" | "review" | "incoming";

export type BusinessInboxItem = {
  id: string;
  source: "mission" | "booking" | "integration";
  sourceId: string;
  kind: InboxKind;
  priority: InboxPriority;
  title: string;
  summary: string;
  evidence: string[];
  actionLabel: string;
  actionHref: string;
  occurredAt: string;
};

type MissionInboxRecord = {
  id: string;
  goal: string;
  status: string;
  updated?: string;
  progress?: { percent?: number; latestMessage?: string | null };
};

type BookingInboxRecord = {
  id: string;
  attendee_name?: string;
  start_time: string;
  status?: string;
  duration?: number;
};

export function missionInboxItem(mission: MissionInboxRecord): BusinessInboxItem | null {
  const occurredAt = mission.updated ?? new Date(0).toISOString();
  const evidence = [
    mission.progress?.latestMessage,
    typeof mission.progress?.percent === "number" ? `${mission.progress.percent}% complete` : null,
  ].filter((value): value is string => Boolean(value));

  if (mission.status === "waiting_for_approval") {
    return {
      id: `mission:${mission.id}:approval`, source: "mission", sourceId: mission.id,
      kind: "approval", priority: "critical", title: "Your approval is needed",
      summary: mission.goal, evidence, actionLabel: "Review and approve",
      actionHref: `/dashboard/missions#${mission.id}`, occurredAt,
    };
  }

  if (["repairing", "blocked", "failed"].includes(mission.status)) {
    return {
      id: `mission:${mission.id}:repair`, source: "mission", sourceId: mission.id,
      kind: "repair", priority: "high", title: "A mission needs attention",
      summary: mission.goal, evidence, actionLabel: "Help STAFFD recover",
      actionHref: `/dashboard/missions#${mission.id}`, occurredAt,
    };
  }

  if (mission.status === "completed") {
    return {
      id: `mission:${mission.id}:review`, source: "mission", sourceId: mission.id,
      kind: "review", priority: "normal", title: "Finished work is ready",
      summary: mission.goal, evidence, actionLabel: "Review the result",
      actionHref: `/dashboard/missions#${mission.id}`, occurredAt,
    };
  }

  return null;
}

export function bookingInboxItem(booking: BookingInboxRecord, now = new Date()): BusinessInboxItem | null {
  if (booking.status === "cancelled") return null;
  const starts = new Date(booking.start_time);
  if (!Number.isFinite(starts.getTime()) || starts.getTime() < now.getTime()) return null;
  const hoursAway = (starts.getTime() - now.getTime()) / 3_600_000;
  if (hoursAway > 72) return null;

  const attendee = booking.attendee_name?.trim() || "A customer";
  return {
    id: `booking:${booking.id}`, source: "booking", sourceId: booking.id,
    kind: "booking", priority: hoursAway <= 24 ? "high" : "normal",
    title: "An upcoming conversation needs preparation",
    summary: `${attendee} is booked for ${starts.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`,
    evidence: booking.duration ? [`${booking.duration} minute booking`] : [],
    actionLabel: "Prepare for the meeting", actionHref: "/dashboard",
    occurredAt: booking.start_time,
  };
}

const PRIORITY_WEIGHT: Record<InboxPriority, number> = { critical: 3, high: 2, normal: 1 };

export function buildBusinessInbox(items: Array<BusinessInboxItem | null>, limit = 20): BusinessInboxItem[] {
  const unique = new Map<string, BusinessInboxItem>();
  for (const item of items) if (item) unique.set(item.id, item);
  return [...unique.values()]
    .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, Math.max(0, limit));
}
