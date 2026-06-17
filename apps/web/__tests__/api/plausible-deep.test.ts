/**
 * W80.3 — GET /api/integrations/plausible?view=deep (Site Analytics surface).
 *
 * Deep view behind the Front Desk Analytics page: headline metrics +
 * source/page/country breakdowns + visitor timeseries for a selected range
 * (today / 7d / 30d). Super-admin gated. Two-tier cache keyed by range:
 * 5-min on headline+timeseries, 15-min on the slow-moving breakdowns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));

// W91 — mock identity + resolveCredentials (env-mirroring, no fetch).
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => ({ id: "admin", email: "admin@staffd.com" }) }));
vi.mock("../../app/api/_lib/integrations/resolve", () => ({
  resolveCredentials: async () => {
    const key = process.env.PLAUSIBLE_API_KEY, site = process.env.PLAUSIBLE_SITE_ID;
    return key && site ? { source: "operator", url: process.env.NEXT_PUBLIC_PLAUSIBLE_URL || "https://plausible.io", key, config: { site_id: site } } : null;
  },
}));

import { GET, _clearPlausibleCache } from "../../app/api/integrations/plausible/route";

function req(qs: string): Request {
  return new Request(`https://staffd.test/api/integrations/plausible${qs}`);
}

function stubDeepFetch() {
  fetchMock.fn.mockImplementation(async (url: string) => {
    if (url.includes("/aggregate")) {
      return { ok: true, json: async () => ({ results: {
        visitors: { value: 312 }, pageviews: { value: 1045 },
        bounce_rate: { value: 48 }, visit_duration: { value: 125 },
      } }) };
    }
    if (url.includes("/timeseries")) {
      return { ok: true, json: async () => ({ results: [
        { date: "2026-06-10", visitors: 40 }, { date: "2026-06-11", visitors: 52 },
      ] }) };
    }
    if (url.includes("property=visit:source")) {
      return { ok: true, json: async () => ({ results: [{ source: "Google", visitors: 180 }] }) };
    }
    if (url.includes("property=event:page")) {
      return { ok: true, json: async () => ({ results: [{ page: "/pricing", pageviews: 200 }] }) };
    }
    if (url.includes("property=visit:country")) {
      return { ok: true, json: async () => ({ results: [{ country: "United States", visitors: 210 }] }) };
    }
    return { ok: true, json: async () => ({ results: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock.fn);
}

beforeEach(() => {
  _clearPlausibleCache();
  fetchMock.fn.mockReset();
  vi.stubEnv("PLAUSIBLE_API_KEY", "key");
  vi.stubEnv("PLAUSIBLE_SITE_ID", "staffd.com");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET deep view (W80.3)", () => {
  it("returns 503 when not configured", async () => {
    vi.stubEnv("PLAUSIBLE_API_KEY", "");
    const res = await GET(req("?view=deep&range=7d"));
    expect(res.status).toBe(503);
  });

  it("maps headline + breakdowns + timeseries", async () => {
    stubDeepFetch();
    const res = await GET(req("?view=deep&range=7d"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.range).toBe("7d");
    expect(d.headline).toMatchObject({ visitors: 312, pageviews: 1045, bounceRate: 48, visitDuration: 125 });
    expect(d.sources[0]).toMatchObject({ name: "Google", visitors: 180 });
    expect(d.pages[0]).toMatchObject({ name: "/pricing", pageviews: 200 });
    expect(d.countries[0]).toMatchObject({ name: "United States", visitors: 210 });
    expect(d.timeseries).toHaveLength(2);
    expect(d.timeseries[0]).toMatchObject({ date: "2026-06-10", visitors: 40 });
  });

  it("range=day toggles the upstream period to day", async () => {
    stubDeepFetch();
    await GET(req("?view=deep&range=day"));
    const urls = fetchMock.fn.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes("period=day"))).toBe(true);
  });

  it("range=30d toggles the upstream period to 30d", async () => {
    stubDeepFetch();
    await GET(req("?view=deep&range=30d"));
    const urls = fetchMock.fn.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes("period=30d"))).toBe(true);
  });

  it("an unknown range falls back to 7d (operators only get the three toggles)", async () => {
    stubDeepFetch();
    const res = await GET(req("?view=deep&range=banana"));
    const d = await res.json();
    expect(d.range).toBe("7d");
    const urls = fetchMock.fn.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes("period=7d"))).toBe(true);
  });

  it("returns 502 when the aggregate upstream fails", async () => {
    fetchMock.fn.mockImplementation(async (url: string) =>
      url.includes("/aggregate")
        ? { ok: false, status: 500, text: async () => "boom" }
        : { ok: true, json: async () => ({ results: [] }) },
    );
    vi.stubGlobal("fetch", fetchMock.fn);
    const res = await GET(req("?view=deep&range=7d"));
    expect(res.status).toBe(502);
  });

  it("degrades gracefully when a breakdown fails (headline still returned, list empty)", async () => {
    fetchMock.fn.mockImplementation(async (url: string) => {
      if (url.includes("/aggregate")) return { ok: true, json: async () => ({ results: { visitors: { value: 5 }, pageviews: { value: 9 }, bounce_rate: { value: 0 }, visit_duration: { value: 0 } } }) };
      if (url.includes("/timeseries")) return { ok: true, json: async () => ({ results: [] }) };
      return { ok: false, status: 500, text: async () => "boom" }; // all breakdowns fail
    });
    vi.stubGlobal("fetch", fetchMock.fn);
    const res = await GET(req("?view=deep&range=7d"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.headline.visitors).toBe(5);
    expect(d.sources).toEqual([]);
  });

  it("caches a repeat call within TTL — no extra upstream hits", async () => {
    stubDeepFetch();
    await GET(req("?view=deep&range=7d"));
    const after1 = fetchMock.fn.mock.calls.length;
    await GET(req("?view=deep&range=7d"));
    expect(fetchMock.fn.mock.calls.length).toBe(after1); // served from cache
  });

  it("cache key includes the range — switching range re-fetches", async () => {
    stubDeepFetch();
    await GET(req("?view=deep&range=7d"));
    const after7 = fetchMock.fn.mock.calls.length;
    await GET(req("?view=deep&range=30d"));
    expect(fetchMock.fn.mock.calls.length).toBeGreaterThan(after7); // different key → re-fetch
  });
});
