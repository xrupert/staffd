import { describe, expect, it } from "vitest";
import type { BusinessInboxItem } from "./business-inbox";
import { notificationDeliveryKey, notificationDigestDeliveryItem } from "./notification-dispatch";
import type { NotificationDigest } from "./notification-digest";
import { pushPayloadForDigest } from "./notification-push-digest";

const item: BusinessInboxItem = {
  id: "mission-1-approval",
  source: "mission",
  sourceId: "mission-1",
  kind: "approval",
  priority: "critical",
  title: "Approval needed",
  summary: "Approve the campaign before it is sent.",
  evidence: ["One outbound step is waiting"],
  actionLabel: "Review",
  actionHref: "/dashboard/missions?mission=mission-1",
  occurredAt: "2026-08-05T12:00:00.000Z",
};

const digest: NotificationDigest = {
  generatedAt: "2026-08-05T12:30:00.000Z",
  frequency: "daily",
  channels: ["in_app", "push"],
  immediate: [],
  digestItems: [item],
  summary: { total: 3, critical: 1, high: 1, normal: 1 },
};

describe("owner push digests", () => {
  it("builds a concise push that routes to the owner inbox", () => {
    expect(pushPayloadForDigest(digest)).toEqual({
      title: "Daily owner digest",
      body: "3 items need attention · 1 critical · 1 high · 1 normal",
      url: "/dashboard",
      tag: "staffd-notification-digest-daily-2026-08-05",
    });
  });

  it("uses one stable push delivery identity throughout the same digest period", () => {
    const morning = notificationDigestDeliveryItem(digest);
    const evening = notificationDigestDeliveryItem({ ...digest, generatedAt: "2026-08-05T23:59:59.000Z" });
    expect(morning).not.toBeNull();
    expect(evening).not.toBeNull();
    expect(notificationDeliveryKey("user-1", morning!, "push")).toBe(
      notificationDeliveryKey("user-1", evening!, "push"),
    );
  });

  it("keeps push and email digest replay identities isolated", () => {
    const deliveryItem = notificationDigestDeliveryItem(digest);
    expect(deliveryItem).not.toBeNull();
    expect(notificationDeliveryKey("user-1", deliveryItem!, "push")).not.toBe(
      notificationDeliveryKey("user-1", deliveryItem!, "email"),
    );
  });

  it("suppresses disabled and empty digests", () => {
    expect(pushPayloadForDigest({ ...digest, frequency: "off" })).toBeNull();
    expect(pushPayloadForDigest({
      ...digest,
      digestItems: [],
      summary: { total: 0, critical: 0, high: 0, normal: 0 },
    })).toBeNull();
  });
});
