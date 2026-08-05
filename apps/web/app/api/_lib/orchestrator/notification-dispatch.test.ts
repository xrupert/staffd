import { describe, expect, it } from "vitest";
import type { BusinessInboxItem } from "./business-inbox";
import {
  emailPayloadForDigest,
  emailPayloadForInboxItem,
  notificationDeliveryKey,
  notificationDigestDeliveryItem,
  pushPayloadForInboxItem,
} from "./notification-dispatch";
import type { NotificationDigest } from "./notification-digest";

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
  periodKey: "2026-08-05",
  channels: ["in_app", "email"],
  immediate: [],
  digestItems: [item],
  summary: { total: 1, critical: 1, high: 0, normal: 0 },
};

describe("notificationDeliveryKey", () => {
  it("is stable for the same owner, channel, item, and occurrence", () => {
    expect(notificationDeliveryKey("user-1", item)).toBe(notificationDeliveryKey("user-1", item));
  });

  it("changes across owners, channels, and occurrences", () => {
    expect(notificationDeliveryKey("user-1", item)).not.toBe(notificationDeliveryKey("user-2", item));
    expect(notificationDeliveryKey("user-1", item, "push")).not.toBe(
      notificationDeliveryKey("user-1", item, "email"),
    );
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

describe("emailPayloadForInboxItem", () => {
  it("builds a concise email that routes to the governed STAFFD action", () => {
    const payload = emailPayloadForInboxItem("owner@example.com", item);
    expect(payload.to).toEqual(["owner@example.com"]);
    expect(payload.subject).toBe("[STAFFD] Approval needed");
    expect(payload.text).toContain("https://urstaffd.com/dashboard/missions?mission=mission-1");
    expect(payload.html).toContain("One outbound step is waiting");
  });

  it("escapes inbox content before rendering HTML", () => {
    const payload = emailPayloadForInboxItem("owner@example.com", {
      ...item,
      title: "Review <script>",
      summary: "A & B",
      evidence: ["<unsafe>"],
    });
    expect(payload.html).not.toContain("<script>");
    expect(payload.html).toContain("Review &lt;script&gt;");
    expect(payload.html).toContain("A &amp; B");
    expect(payload.html).toContain("&lt;unsafe&gt;");
  });
});

describe("owner email digests", () => {
  it("uses one stable daily delivery identity for every refresh in the same owner-local day", () => {
    const beforeUtcMidnight = notificationDigestDeliveryItem({
      ...digest,
      generatedAt: "2026-08-05T23:59:59.000Z",
    });
    const afterUtcMidnight = notificationDigestDeliveryItem({
      ...digest,
      generatedAt: "2026-08-06T00:30:00.000Z",
    });
    expect(beforeUtcMidnight?.id).toBe("notification-digest-daily-2026-08-05");
    expect(afterUtcMidnight?.id).toBe(beforeUtcMidnight?.id);
    expect(notificationDeliveryKey("user-1", beforeUtcMidnight!, "email")).toBe(
      notificationDeliveryKey("user-1", afterUtcMidnight!, "email"),
    );
  });

  it("anchors weekly delivery identity to the owner-local Monday", () => {
    const sundayUtc = notificationDigestDeliveryItem({
      ...digest,
      frequency: "weekly",
      periodKey: "2026-08-03",
      generatedAt: "2026-08-10T03:30:00.000Z",
    });
    expect(sundayUtc?.occurredAt).toBe("2026-08-03T00:00:00.000Z");
    expect(sundayUtc?.id).toBe("notification-digest-weekly-2026-08-03");
  });

  it("renders a bounded escaped digest with governed STAFFD links", () => {
    const payload = emailPayloadForDigest("owner@example.com", {
      ...digest,
      digestItems: [{ ...item, title: "Review <script>", summary: "A & B" }],
    });
    expect(payload?.subject).toBe("[STAFFD] Daily owner digest: 1 item");
    expect(payload?.html).not.toContain("<script>");
    expect(payload?.html).toContain("Review &lt;script&gt;");
    expect(payload?.html).toContain("A &amp; B");
    expect(payload?.html).toContain("https://urstaffd.com/dashboard/missions?mission=mission-1");
    expect(payload?.html).toContain("https://urstaffd.com/dashboard");
  });

  it("does not create a delivery for disabled, malformed, or empty digests", () => {
    expect(notificationDigestDeliveryItem({ ...digest, frequency: "off", periodKey: null })).toBeNull();
    expect(notificationDigestDeliveryItem({ ...digest, periodKey: "not-a-date" })).toBeNull();
    expect(notificationDigestDeliveryItem({
      ...digest,
      digestItems: [],
      summary: { total: 0, critical: 0, high: 0, normal: 0 },
    })).toBeNull();
  });
});
