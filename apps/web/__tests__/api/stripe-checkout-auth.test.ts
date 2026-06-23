/**
 * W95.7.3d-h6c — the Stripe checkout routes must authenticate the caller. They
 * previously read `userId` from the request body and used the PB ADMIN token, so
 * an unauthenticated caller could bind a checkout/customer to another user.
 * These pin the 401-without-a-session guard for all four routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));
const stripeSpy = vi.hoisted(() => ({ constructed: 0 }));
vi.mock("stripe", () => ({ default: class { constructor() { stripeSpy.constructed += 1; } } }));

import { POST as checkout } from "../../app/api/stripe/checkout/route";
import { POST as addon } from "../../app/api/stripe/checkout-addon/route";
import { POST as ceoAddon } from "../../app/api/stripe/checkout-ceo-addon/route";
import { POST as topup } from "../../app/api/stripe/checkout-topup/route";

const req = (body: object) => new Request("https://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  auth.user = null; // unauthenticated
  stripeSpy.constructed = 0;
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test";
});
afterEach(() => { vi.restoreAllMocks(); });

describe("stripe checkout routes — auth required, no body-userId trust (h6c)", () => {
  it("checkout → 401 without a session, no Stripe session", async () => {
    expect((await checkout(req({ planId: "growth", interval: "monthly" }))).status).toBe(401);
    expect(stripeSpy.constructed).toBe(0);
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
