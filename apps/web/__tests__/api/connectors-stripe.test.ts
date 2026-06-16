/**
 * MS-A — GET /api/connectors/stripe (live business pulse).
 *
 * Reads the operator's own Stripe to surface live MRR + active subscription
 * count, normalizing monthly/annual prices to a monthly figure. This is the
 * "read your real revenue" capability — a building block for the autonomy
 * loop and a dashboard pulse widget. Uses the existing STRIPE_SECRET_KEY.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("stripe", () => ({
  default: class StripeStub {
    subscriptions = { list: stripeMock.list };
  },
}));

import { GET } from "../../app/api/connectors/stripe/route";

function req(): Request {
  return new Request("https://staffd.test/api/connectors/stripe");
}

beforeEach(() => {
  stripeMock.list.mockReset();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/connectors/stripe (MS-A)", () => {
  it("returns 503 when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("computes MRR from active subscriptions, normalizing annual to monthly", async () => {
    stripeMock.list.mockResolvedValueOnce({
      data: [
        // $149/mo → 149.00
        { items: { data: [{ quantity: 1, price: { unit_amount: 14900, currency: "usd", recurring: { interval: "month" } } }] } },
        // $4,500/yr → 375.00/mo
        { items: { data: [{ quantity: 1, price: { unit_amount: 450000, currency: "usd", recurring: { interval: "year" } } }] } },
        // $29/mo × 2 → 58.00
        { items: { data: [{ quantity: 2, price: { unit_amount: 2900, currency: "usd", recurring: { interval: "month" } } }] } },
      ],
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.activeSubscriptions).toBe(3);
    // 149 + 375 + 58 = 582.00
    expect(data.mrr).toBeCloseTo(582, 2);
    expect(data.currency).toBe("usd");
  });

  it("returns zeros when there are no active subscriptions", async () => {
    stripeMock.list.mockResolvedValueOnce({ data: [] });
    const res = await GET(req());
    const data = await res.json();
    expect(data.activeSubscriptions).toBe(0);
    expect(data.mrr).toBe(0);
  });

  it("returns 502 on a Stripe API error", async () => {
    stripeMock.list.mockRejectedValueOnce(new Error("stripe down"));
    const res = await GET(req());
    expect(res.status).toBe(502);
  });
});
