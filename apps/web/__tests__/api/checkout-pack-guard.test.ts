/**
 * W58.3 Test 6 — pack checkout server-side guard.
 *
 * /api/stripe/checkout-pack returns 410 Gone with the locked body for
 * every caller (including stale cached clients), and never constructs a
 * Stripe session.
 */

import { describe, it, expect, vi } from "vitest";

const stripeSpy = vi.hoisted(() => ({ constructed: 0 }));
vi.mock("stripe", () => ({
  default: class StripeMock {
    constructor() { stripeSpy.constructed += 1; }
  },
}));

import { POST } from "../../app/api/stripe/checkout-pack/route";

describe("checkout-pack guard (W58.3)", () => {
  it("returns 410 with the locked packs_now_automatic body; no Stripe session created", async () => {
    const res = await POST();
    expect(res.status).toBe(410);

    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("packs_now_automatic");
    expect(body.message).toContain("included automatically based on your business industry");
    expect(body.message).toContain("Update your industry in Settings");

    expect(stripeSpy.constructed).toBe(0);
  });
});
