/**
 * W80.1a — GET /api/integrations/plausible (operator site analytics).
 *
 * Today's unique visitors + pageviews + top sources for the operator's
 * Plausible site. Super-admin gated (operator-private data). Aggressively
 * cached — Plausible Cloud caps the Stats API at ~600 req/hr, so repeat
 * loads must NOT re-hit the upstream.
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

function req(): Request {
  return new Request("https://staffd.test/api/integrations/plausible");
}

function stubFetch() {
  fetchMock.fn.mockImplementation(async (url: string) => {
    if (url.includes("/aggregate")) {
      return { ok: true, json: async () => ({ results: { visitors: { value: 312 }, pageviews: { value: 1045 } } }) };
    }
    // breakdown
    return { ok: true, json: async () => ({ results: [
      { source: "Google", visitors: 180 },
      { source: "Direct / None", visitors: 90 },
    ] }) };
  });
  vi.stubGlobal("fetch", fetchMock.fn);
}

beforeEach(() => {
  _clearPlausibleCache();
  fetchMock.fn.mockReset();
  vi.stubEnv("PLAUSIBLE_API_KEY", "key");
  vi.stubEnv("PLAUSIBLE_SITE_ID", "staffd.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/plausible (W80.1a)", () => {
  it("returns 503 when not configured", async () => {
    vi.stubEnv("PLAUSIBLE_API_KEY", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("maps aggregate + breakdown to visitors / pageviews / sources", async () => {
    stubFetch();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.visitors).toBe(312);
    expect(data.pageviews).toBe(1045);
    expect(data.sources).toHaveLength(2);
    expect(data.sources[0]).toMatchObject({ source: "Google", visitors: 180 });
  });

  it("caches — a second call within TTL does NOT re-hit Plausible", async () => {
    stubFetch();
    await GET(req());            // 2 upstream calls (aggregate + breakdown)
    await GET(req());            // served from cache → still 2 total
    expect(fetchMock.fn).toHaveBeenCalledTimes(2);
  });

  it("returns 502 on an upstream error", async () => {
    fetchMock.fn.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    vi.stubGlobal("fetch", fetchMock.fn);
    const res = await GET(req());
    expect(res.status).toBe(502);
  });
});
