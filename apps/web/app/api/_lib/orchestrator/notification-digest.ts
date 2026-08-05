import type { BusinessInboxItem, InboxPriority } from "./business-inbox";
import {
  shouldDeliverImmediately,
  type NotificationChannel,
  type NotificationPreferences,
} from "./notification-policy";

export type NotificationDigest = {
  generatedAt: string;
  frequency: NotificationPreferences["digest"];
  channels: NotificationChannel[];
  immediate: Array<{
    item: BusinessInboxItem;
    channels: NotificationChannel[];
  }>;
  digestItems: BusinessInboxItem[];
  summary: {
    total: number;
    critical: number;
    high: number;
    normal: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function validOccurredAt(item: BusinessInboxItem): number | null {
  const value = new Date(item.occurredAt).getTime();
  return Number.isFinite(value) ? value : null;
}

function occurredWithin(item: BusinessInboxItem, now: Date, windowMs: number): boolean {
  const occurredAt = validOccurredAt(item);
  return occurredAt !== null
    && occurredAt <= now.getTime()
    && occurredAt >= now.getTime() - windowMs;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function mondayDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function digestPeriodKey(
  frequency: NotificationPreferences["digest"],
  timezone: string,
  date: Date,
): string | null {
  if (frequency !== "daily" && frequency !== "weekly") return null;
  const localDate = localDateKey(date, timezone);
  return frequency === "weekly" ? mondayDateKey(localDate) : localDate;
}

function itemInDigestPeriod(
  item: BusinessInboxItem,
  frequency: NotificationPreferences["digest"],
  timezone: string,
  currentPeriod: string,
  now: Date,
): boolean {
  const occurredAt = validOccurredAt(item);
  if (occurredAt === null || occurredAt > now.getTime()) return false;
  return digestPeriodKey(frequency, timezone, new Date(occurredAt)) === currentPeriod;
}

function countPriority(items: readonly BusinessInboxItem[], priority: InboxPriority): number {
  return items.filter((item) => item.priority === priority).length;
}

export function buildNotificationDigest(
  items: readonly BusinessInboxItem[],
  preferences: NotificationPreferences,
  now = new Date(),
): NotificationDigest {
  const generatedAt = now.toISOString();
  const immediate = items.filter((item) => occurredWithin(item, now, DAY_MS)).flatMap((item) => {
    const channels = preferences.channels.filter((channel) =>
      shouldDeliverImmediately(item.priority, channel, preferences, now),
    );
    return channels.length ? [{ item, channels }] : [];
  });

  const currentPeriod = digestPeriodKey(preferences.digest, preferences.timezone, now);
  const digestItems = currentPeriod
    ? items.filter((item) => itemInDigestPeriod(
      item,
      preferences.digest,
      preferences.timezone,
      currentPeriod,
      now,
    ))
    : [];

  return {
    generatedAt,
    frequency: preferences.digest,
    channels: preferences.channels,
    immediate,
    digestItems,
    summary: {
      total: digestItems.length,
      critical: countPriority(digestItems, "critical"),
      high: countPriority(digestItems, "high"),
      normal: countPriority(digestItems, "normal"),
    },
  };
}
