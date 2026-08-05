import { describe, expect, it } from "vitest";
import type { BusinessInboxItem } from "./business-inbox";
import { buildNotificationDigest } from "./notification-digest";
import type { NotificationPreferences } from "./notification-policy";

function item(overrides: Partial<BusinessInboxItem> = {}): BusinessInboxItem {
  return {
    id: "item-1",
    source: "mission",
    sourceId: "mission-1",
    kind: "approval",
    priority: "critical",
    title: "Approval needed",
    summary: "Approve the campaign",
    evidence: [],
    actionLabel: "Review",
    actionHref: "/dashboard/missions",
    occurredAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

const preferences: NotificationPreferences = {
  channels: ["in_app", "email", "push"],
  digest: "daily",
  timezone: "America/New_York",
  quietHours: { enabled: true, start: "22:00", end: "07:00" },
  immediatePriorities: ["critical"],
};

describe("buildNotificationDigest", () => {
  it("builds a bounded daily digest and immediate delivery plan", () => {
    const now = new Date("2026-08-05T16:00:00.000Z");
    const digest = buildNotificationDigest([
      item(),
      item({ id: "high", priority: "high", occurredAt: "2026-08-05T11:00:00.000Z" }),
      item({ id: "old", occurredAt: "2026-08-03T12:00:00.000Z" }),
      item({ id: "future", occurredAt: "2026-08-05T18:00:00.000Z" }),
    ], preferences, now);

    expect(digest.periodKey).toBe("2026-08-05");
    expect(digest.digestItems.map((entry) => entry.id)).toEqual(["item-1", "high"]);
    expect(digest.immediate).toHaveLength(1);
    expect(digest.immediate[0]?.channels).toEqual(["in_app", "email", "push"]);
    expect(digest.summary).toEqual({ total: 2, critical: 1, high: 1, normal: 0 });
  });

  it("uses the owner's local day instead of the UTC day", () => {
    const now = new Date("2026-08-05T02:00:00.000Z");
    const digest = buildNotificationDigest([
      item({ id: "local-tuesday", occurredAt: "2026-08-05T01:30:00.000Z" }),
      item({ id: "local-wednesday", occurredAt: "2026-08-05T05:00:00.000Z" }),
    ], preferences, now);

    expect(digest.periodKey).toBe("2026-08-04");
    expect(digest.digestItems.map((entry) => entry.id)).toEqual(["local-tuesday"]);
  });

  it("anchors weekly digests to Monday in the owner's timezone", () => {
    const weekly = { ...preferences, digest: "weekly" as const };
    const now = new Date("2026-08-10T03:30:00.000Z");
    const digest = buildNotificationDigest([
      item({ id: "sunday-local", occurredAt: "2026-08-10T03:00:00.000Z" }),
      item({ id: "monday-local", occurredAt: "2026-08-10T04:30:00.000Z" }),
    ], weekly, now);

    expect(digest.periodKey).toBe("2026-08-03");
    expect(digest.digestItems.map((entry) => entry.id)).toEqual(["sunday-local"]);
  });

  it("suppresses external immediate delivery during quiet hours", () => {
    const digest = buildNotificationDigest(
      [item({ occurredAt: "2026-08-05T02:30:00.000Z" })],
      preferences,
      new Date("2026-08-05T03:00:00.000Z"),
    );

    expect(digest.immediate[0]?.channels).toEqual(["in_app"]);
  });

  it("returns no digest items when digests are disabled", () => {
    const digest = buildNotificationDigest(
      [item()],
      { ...preferences, digest: "off" },
      new Date("2026-08-05T16:00:00.000Z"),
    );

    expect(digest.periodKey).toBeNull();
    expect(digest.digestItems).toEqual([]);
    expect(digest.summary.total).toBe(0);
    expect(digest.immediate).toHaveLength(1);
  });

  it("ignores invalid timestamps instead of widening the window", () => {
    const digest = buildNotificationDigest(
      [item({ occurredAt: "not-a-date" })],
      preferences,
      new Date("2026-08-05T16:00:00.000Z"),
    );

    expect(digest.digestItems).toEqual([]);
    expect(digest.immediate).toEqual([]);
  });
});
