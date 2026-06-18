/**
 * W95.6.y — PlausibleClient leak-guard: site-per-customer. forCustomer refuses
 * an empty id; stats refuse when no site is provisioned; every read injects the
 * stored site_id; no raw HTTP escape hatch; hasSiteFor gates the empty state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "tok",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { PlausibleClient } from "../../app/api/_lib/integrations/plausible/client";
import * as mod from "../../app/api/_lib/integrations/plausible/client";

const calls: { url: string; method: string }[] = [];
let storedSiteId: string | null; // businesses.plausible_site_id

function setFetch() {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/businesses/records?")) {
      return { ok: true, status: 200, json: async () => ({ items: storedSiteId ? [{ plausible_site_id: storedSiteId }] : [{}] }) };
    }
    if (url.includes("/stats/aggregate")) return { ok: true, status: 200, json: async () => ({ results: { visitors: { value: 12 }, pageviews: { value: 40 }, bounce_rate: { value: 33 }, visit_duration: { value: 95 } } }) };
    if (url.includes("/stats/timeseries")) return { ok: true, status: 200, json: async () => ({ results: [{ date: "2026-06-01", visitors: 3, pageviews: 9 }, { date: "2026-06-02", visitors: 5, pageviews: 12 }] }) };
    if (url.includes("property=event:page")) return { ok: true, status: 200, json: async () => ({ results: [{ page: "/pricing", visitors: 8 }] }) };
    if (url.includes("property=visit:source")) return { ok: true, status: 200, json: async () => ({ results: [{ source: "Google", visitors: 6 }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

beforeEach(() => {
  storedSiteId = "acme.com";
  vi.stubEnv("PLAUSIBLE_API_URL", "https://pl.test");
  vi.stubEnv("PLAUSIBLE_API_KEY", "k");
  setFetch();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("PlausibleClient leak-guard", () => {
  it("refuses an untenanted client", () => {
    expect(() => PlausibleClient.forCustomer("")).toThrow(/customerId|tenant/i);
    expect(() => PlausibleClient.forCustomer(null)).toThrow();
  });

  it("does NOT export a raw HTTP helper (structural guard)", () => {
    expect(Object.keys(mod)).toEqual(["PlausibleClient"]);
  });

  it("configured reflects base + key env", () => {
    expect(PlausibleClient.configured).toBe(true);
    vi.stubEnv("PLAUSIBLE_API_KEY", "");
    expect(PlausibleClient.configured).toBe(false);
  });

  it("hasSiteFor is true when a site is stored, false when not", async () => {
    storedSiteId = "acme.com";
    expect(await PlausibleClient.hasSiteFor("userA")).toBe(true);
    storedSiteId = null;
    expect(await PlausibleClient.hasSiteFor("userA")).toBe(false);
    expect(await PlausibleClient.hasSiteFor("")).toBe(false);
  });

  it("getAggregateStats injects the stored site_id and maps the shape", async () => {
    const agg = await PlausibleClient.forCustomer("userA").getAggregateStats({ period: "7d" });
    expect(agg).toEqual({ visitors: 12, pageviews: 40, bounce_rate: 33, visit_duration_seconds: 95 });
    expect(calls.some((c) => c.url.includes("/stats/aggregate?site_id=acme.com&period=7d"))).toBe(true);
  });

  it("stats THROW when no site_id is provisioned (no leak to another tenant)", async () => {
    storedSiteId = null;
    await expect(PlausibleClient.forCustomer("userA").getAggregateStats({ period: "7d" })).rejects.toThrow(/site_id|provisioned/i);
  });

  it("getTopPages / getTopSources scope to the site and map breakdown rows", async () => {
    const c = PlausibleClient.forCustomer("userA");
    expect(await c.getTopPages({ period: "7d" })).toEqual([{ page: "/pricing", visitors: 8 }]);
    expect(await c.getTopSources({ period: "7d" })).toEqual([{ source: "Google", visitors: 6 }]);
    expect(calls.every((c) => !c.url.includes("/stats/") || c.url.includes("site_id=acme.com"))).toBe(true);
  });

  it("getTimeseries returns the per-day series", async () => {
    const ts = await PlausibleClient.forCustomer("userA").getTimeseries({ period: "30d" });
    expect(ts).toEqual([{ date: "2026-06-01", visitors: 3, pageviews: 9 }, { date: "2026-06-02", visitors: 5, pageviews: 12 }]);
  });
});
