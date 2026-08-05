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
const FREQUENCY_WINDOW_MS: Record<Exclude<NotificationPreferences["digest"], "off">, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
};

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

  const digestItems = preferences.digest === "off"
    ? []
    : items.filter((item) => occurredWithin(item, now, FREQUENCY_WINDOW_MS[preferences.digest]));

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
