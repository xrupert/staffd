import { describe, expect, it } from "vitest";
import { notificationDeliveryRetryable } from "./notification-retry";

type ChannelDelivery = {
  channel: "push" | "email";
  status: "pending" | "sent" | "failed";
  attempts: number;
  updated: string;
};

function retryable(delivery: ChannelDelivery, now: Date): boolean {
  return notificationDeliveryRetryable(delivery, now);
}

describe("core notification delivery retries", () => {
  const now = new Date("2026-08-05T12:10:00.000Z");

  it.each(["push", "email"] as const)("reclaims a failed %s delivery only after backoff", (channel) => {
    expect(retryable({
      channel,
      status: "failed",
      attempts: 1,
      updated: "2026-08-05T12:05:00.000Z",
    }, now)).toBe(true);

    expect(retryable({
      channel,
      status: "failed",
      attempts: 2,
      updated: "2026-08-05T12:05:00.000Z",
    }, now)).toBe(false);
  });

  it.each(["push", "email"] as const)("preserves replay protection for %s deliveries already in flight or sent", (channel) => {
    expect(retryable({
      channel,
      status: "pending",
      attempts: 1,
      updated: now.toISOString(),
    }, now)).toBe(false);

    expect(retryable({
      channel,
      status: "sent",
      attempts: 1,
      updated: now.toISOString(),
    }, now)).toBe(false);
  });
});
