import type { InboxPriority } from "./business-inbox";

export type NotificationChannel = "in_app" | "email" | "push";
export type DigestFrequency = "off" | "daily" | "weekly";

export type NotificationPreferences = {
  channels: NotificationChannel[];
  digest: DigestFrequency;
  timezone: string;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  immediatePriorities: InboxPriority[];
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: ["in_app"],
  digest: "daily",
  timezone: "UTC",
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
  immediatePriorities: ["critical"],
};

const CHANNELS = new Set<NotificationChannel>(["in_app", "email", "push"]);
const DIGESTS = new Set<DigestFrequency>(["off", "daily", "weekly"]);
const PRIORITIES = new Set<InboxPriority>(["critical", "high", "normal"]);
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function uniqueAllowed<T extends string>(value: unknown, allowed: Set<T>): T[] | null {
  if (!Array.isArray(value)) return null;
  const items = [...new Set(value.filter((item): item is T => typeof item === "string" && allowed.has(item as T)))];
  return items.length === value.length ? items : null;
}

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NotificationPreferences>;
  const channels = uniqueAllowed(candidate.channels, CHANNELS);
  const immediatePriorities = uniqueAllowed(candidate.immediatePriorities, PRIORITIES);
  if (!channels || channels.length === 0 || !immediatePriorities) return null;
  if (!candidate.digest || !DIGESTS.has(candidate.digest)) return null;
  if (!validTimezone(candidate.timezone)) return null;
  if (!candidate.quietHours || typeof candidate.quietHours !== "object") return null;
  const { enabled, start, end } = candidate.quietHours;
  if (typeof enabled !== "boolean" || !CLOCK_PATTERN.test(start ?? "") || !CLOCK_PATTERN.test(end ?? "")) return null;

  return {
    channels,
    digest: candidate.digest,
    timezone: candidate.timezone,
    quietHours: { enabled, start: start!, end: end! },
    immediatePriorities,
  };
}

function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return Number(values.get("hour")) * 60 + Number(values.get("minute"));
}

function clockMinutes(value: string): number {
  const match = CLOCK_PATTERN.exec(value);
  if (!match) throw new Error("A valid notification clock is required");
  return Number(match[1]) * 60 + Number(match[2]);
}

export function notificationQuietHoursActive(
  preferences: NotificationPreferences,
  now = new Date(),
): boolean {
  if (!preferences.quietHours.enabled) return false;
  const current = localMinutes(now, preferences.timezone);
  const start = clockMinutes(preferences.quietHours.start);
  const end = clockMinutes(preferences.quietHours.end);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function shouldDeliverImmediately(
  priority: InboxPriority,
  channel: NotificationChannel,
  preferences: NotificationPreferences,
  now = new Date(),
): boolean {
  if (!preferences.channels.includes(channel)) return false;
  if (!preferences.immediatePriorities.includes(priority)) return false;
  if (channel === "in_app") return true;
  return !notificationQuietHoursActive(preferences, now);
}
