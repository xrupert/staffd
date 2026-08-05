import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  notificationQuietHoursActive,
  shouldDeliverImmediately,
} from "./notification-policy";

describe("notification preferences", () => {
  it("normalizes valid owner preferences", () => {
    expect(normalizeNotificationPreferences({
      channels: ["in_app", "email", "push"],
      digest: "weekly",
      timezone: "America/New_York",
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
      immediatePriorities: ["critical", "high"],
    })).toEqual({
      channels: ["in_app", "email", "push"],
      digest: "weekly",
      timezone: "America/New_York",
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
      immediatePriorities: ["critical", "high"],
    });
  });

  it("rejects invalid channels, clocks, and timezones", () => {
    expect(normalizeNotificationPreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      channels: ["sms"],
    })).toBeNull();
    expect(normalizeNotificationPreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      quietHours: { enabled: true, start: "25:00", end: "07:00" },
    })).toBeNull();
    expect(normalizeNotificationPreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      timezone: "Bad/Timezone",
    })).toBeNull();
  });

  it("handles overnight quiet hours in the owner's timezone", () => {
    const preferences = normalizeNotificationPreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      channels: ["in_app", "email"],
      timezone: "America/New_York",
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    })!;

    expect(notificationQuietHoursActive(preferences, new Date("2026-08-05T03:00:00.000Z"))).toBe(true);
    expect(notificationQuietHoursActive(preferences, new Date("2026-08-05T15:00:00.000Z"))).toBe(false);
  });

  it("keeps in-app critical work visible while suppressing external delivery during quiet hours", () => {
    const preferences = normalizeNotificationPreferences({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      channels: ["in_app", "email", "push"],
      timezone: "America/New_York",
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    })!;
    const quietTime = new Date("2026-08-05T03:00:00.000Z");

    expect(shouldDeliverImmediately("critical", "in_app", preferences, quietTime)).toBe(true);
    expect(shouldDeliverImmediately("critical", "email", preferences, quietTime)).toBe(false);
    expect(shouldDeliverImmediately("critical", "push", preferences, quietTime)).toBe(false);
    expect(shouldDeliverImmediately("high", "in_app", preferences, quietTime)).toBe(false);
  });
});
