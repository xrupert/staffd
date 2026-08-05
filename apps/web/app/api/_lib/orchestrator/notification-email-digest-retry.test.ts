import { describe, expect, it } from "vitest";
import { emailDigestRetryPatch } from "./notification-email-digest-retry";

describe("email digest retry claims", () => {
  it("reclaims eligible failed deliveries and increments attempts", () => {
    expect(emailDigestRetryPatch({
      id: "delivery-1",
      delivery_key: "key-1",
      status: "failed",
      attempts: 2,
      updated: "2026-08-05T12:00:00.000Z",
    })).toEqual({ status: "pending", attempts: 3, last_error: "" });
  });

  it("does not reclaim sent, pending, malformed, or exhausted deliveries", () => {
    expect(emailDigestRetryPatch({
      id: "sent",
      delivery_key: "key-sent",
      status: "sent",
      attempts: 1,
      updated: "2026-08-05T10:00:00.000Z",
    })).toBeNull();
    expect(emailDigestRetryPatch({
      id: "pending",
      delivery_key: "key-pending",
      status: "pending",
      attempts: 1,
      updated: "2026-08-05T10:00:00.000Z",
    })).toBeNull();
    expect(emailDigestRetryPatch({
      id: "malformed",
      delivery_key: "key-malformed",
      status: "failed",
      attempts: 1,
      updated: "not-a-date",
    })).toBeNull();
    expect(emailDigestRetryPatch({
      id: "exhausted",
      delivery_key: "key-exhausted",
      status: "failed",
      attempts: 4,
      updated: "2026-08-05T10:00:00.000Z",
    })).toBeNull();
  });
});
