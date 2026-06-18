/**
 * W95.6.y — GET /api/front-desk/analytics (per-customer, site-per-customer).
 * Honest empty state (hasSite:false) when unconfigured or no site provisioned;
 * otherwise the customer's own aggregate / timeseries / breakdowns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => ({ id: "userA", email: "a@cust.com" }) }));

const guard = vi.hoisted(() => ({ configured: true, hasSite: true }));
vi.mock("../../app/api/_lib/integrations/plausible/client", () => ({
  PlausibleClient: {
    get configured() { return guard.configured; },
    hasSiteFor: async () => guard.hasSite,
    forCustomer: () => ({
      getAggregateStats: async () => ({ visitors: 7, pageviews: 20, bounce_rate: 41, visit_duration_seconds: 60 }),
      getTimeseries: async () => [{ date: "2026-06-01", visitors: 3, pageviews: 8 }],
      getTopPages: async () => [{ page: "/", visitors: 5 }],
      getTopSources: async () => [{ source: "Direct", visitors: 4 }],
    }),
  },
}));

import { GET } from "../../app/api/front-desk/analytics/route";

const req = (p = "7d") => new Request(`https://staffd.test/api/front-desk/analytics?period=${p}`);

beforeEach(() => { guard.configured = true; guard.hasSite = true; });
afterEach(() => vi.restoreAllMocks());

describe("GET /api/front-desk/analytics (W95.6.y)", () => {
  it("hasSite:false when Plausible is not configured", async () => {
    guard.configured = false;
    const data = await (await GET(req())).json();
    expect(data).toEqual({ hasSite: false });
  });

  it("hasSite:false when no site is provisioned for this customer", async () => {
    guard.hasSite = false;
    const data = await (await GET(req())).json();
    expect(data).toEqual({ hasSite: false });
  });

  it("returns the customer's own scoped stats when a site is provisioned", async () => {
    const data = await (await GET(req("30d"))).json();
    expect(data.hasSite).toBe(true);
    expect(data.period).toBe("30d");
    expect(data.aggregate).toMatchObject({ visitors: 7, pageviews: 20 });
    expect(data.topPages).toEqual([{ page: "/", visitors: 5 }]);
    expect(data.topSources).toEqual([{ source: "Direct", visitors: 4 }]);
  });
});
