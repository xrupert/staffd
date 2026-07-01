/**
 * W95.7.3d-h6c — billing routes must authenticate the caller before ever
 * touching the BillingProvider. Pins the 401-without-a-session guard for
 * all four checkout-family routes under /api/billing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));

const providerSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../app/api/_lib/billing/provider", () => ({
  BillingNotConfiguredError: class BillingNotConfiguredError extends Error {},
  getBillingProvider: () => ({
    createCheckoutSession: async () => { providerSpy.calls += 1; return { url: "https://x" }; },
    createPortalSession: async () => { providerSpy.calls += 1; return { url: "https://x" }; },
    cancelSubscription: async () => { providerSpy.calls += 1; },
  }),
}));

import { POST as checkout } from "../../app/api/billing/checkout/route";
import { POST as addon } from "../../app/api/billing/checkout-addon/route";
import { POST as ceoAddon } from "../../app/api/billing/checkout-ceo-addon/route";
import { POST as topup } from "../../app/api/billing/checkout-topup/route";

const req = (body: object) => new Request("https://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  auth.user = null; // unauthenticated
  providerSpy.calls = 0;
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test";
});
afterEach(() => { vi.restoreAllMocks(); });

describe("billing checkout routes — auth required, no body-userId trust (h6c)", () => {
  it("checkout → 401 without a session, provider never called", async () => {
    expect((await checkout(req({ planId: "growth", interval: "monthly" }))).status).toBe(401);
    expect(providerSpy.calls).toBe(0);
  });
  it("checkout-addon → 401 without a session", async () => {
    expect((await addon(req({ department: "hr" }))).status).toBe(401);
  });
  it("checkout-ceo-addon → 401 without a session", async () => {
    expect((await ceoAddon(req({}))).status).toBe(401);
  });
  it("checkout-topup → 401 without a session", async () => {
    expect((await topup(req({ pack: "small" }))).status).toBe(401);
  });
});
