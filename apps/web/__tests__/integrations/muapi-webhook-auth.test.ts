/**
 * W95.7.3c-b1 — webhook capability-token auth + callback URL construction.
 */

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => { process.env.MUAPI_WEBHOOK_SECRET = "whsec_test_abc"; process.env.MUAPI_API_KEY = "k"; });

import { muapiWebhookToken, verifyWebhookToken, buildWebhookUrl, muapiWebhookConfigured } from "../../app/api/_lib/integrations/muapi/predictions";

describe("muapi webhook auth (W95.7.3c-b1)", () => {
  it("configured reflects the secret", () => { expect(muapiWebhookConfigured()).toBe(true); });

  it("verifies a correct token and rejects wrong/empty ones (timing-safe)", () => {
    const t = muapiWebhookToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);              // HMAC-derived, raw secret never exposed
    expect(t).not.toContain("whsec_test_abc");
    expect(verifyWebhookToken(t)).toBe(true);
    expect(verifyWebhookToken("nope")).toBe(false);
    expect(verifyWebhookToken("")).toBe(false);
    expect(verifyWebhookToken(null)).toBe(false);
  });

  it("buildWebhookUrl embeds the token and points at the receiver", () => {
    const u = buildWebhookUrl("https://urstaffd.com");
    expect(u).toBe(`https://urstaffd.com/api/generation/webhook?token=${muapiWebhookToken()}`);
  });

  it("buildWebhookUrl returns null with no base", () => {
    expect(buildWebhookUrl("")).toBeNull();
  });
});
