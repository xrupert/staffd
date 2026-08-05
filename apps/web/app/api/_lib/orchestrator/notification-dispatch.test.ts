import { describe, expect, it } from "vitest";
import type { BusinessInboxItem } from "./business-inbox";
import { notificationDeliveryKey, pushPayloadForInboxItem } from "./notification-dispatch";

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

describe("notificationDeliveryKey", () => {
  it("is stable for the same owner, channel, item, and occurrence", () => {
    expect(notificationDeliveryKey("user-1", item)).toBe(notificationDeliveryKey("user-1", item));
  });

  it("changes across owners and occurrences", () => {
    expect(notificationDeliveryKey("user-1", item)).not.toBe(notificationDeliveryKey("user-2", item));
    expect(notificationDeliveryKey("user-1", item)).not.toBe(
      notificationDeliveryKey("user-1", { ...item, occurredAt: "2026-08-05T13:00:00.000Z" }),
    );
  });
});

describe("pushPayloadForInboxItem", () => {
  it("keeps the notification concise and routes back to the governed STAFFD action", () => {
    expect(pushPayloadForInboxItem(item)).toEqual({
      title: "Approval needed",
      body: "Approve the campaign before it is sent.",
      url: "/dashboard/missions?mission=mission-1",
      tag: "staffd-mission-1-approval",
    });
  });
});
