import { describe, expect, it } from "vitest";
import {
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  notificationDeliveryRetryable,
  notificationRetryDelayMs,
} from "./notification-retry";

describe("notification retry policy", () => {
  it("backs off failed deliveries exponentially with a one-hour ceiling", () => {
    expect(notificationRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(notificationRetryDelayMs(2)).toBe(10 * 60 * 1000);
    expect(notificationRetryDelayMs(4)).toBe(40 * 60 * 1000);
    expect(notificationRetryDelayMs(9)).toBe(60 * 60 * 1000);
  });

  it("retries only failed deliveries whose backoff has elapsed", () => {
    const now = new Date("2026-08-05T12:10:00.000Z");
    expect(notificationDeliveryRetryable({
      status: "failed",
      attempts: 1,
      updated: "2026-08-05T12:05:00.000Z",
    }, now)).toBe(true);
    expect(notificationDeliveryRetryable({
      status: "failed",
      attempts: 2,
      updated: "2026-08-05T12:05:00.000Z",
    }, now)).toBe(false);
    expect(notificationDeliveryRetryable({ status: "pending", attempts: 1, updated: now.toISOString() }, now)).toBe(false);
    expect(notificationDeliveryRetryable({ status: "sent", attempts: 1, updated: now.toISOString() }, now)).toBe(false);
  });

  it("stops retrying at the bounded attempt limit and fails closed on bad timestamps", () => {
    expect(notificationDeliveryRetryable({
      status: "failed",
      attempts: MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
      updated: "2026-08-05T10:00:00.000Z",
    }, new Date("2026-08-05T12:00:00.000Z"))).toBe(false);
    expect(notificationDeliveryRetryable({ status: "failed", attempts: 1, updated: "not-a-date" })).toBe(false);
  });
});
