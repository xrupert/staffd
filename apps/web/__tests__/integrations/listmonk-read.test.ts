/**
 * FC-1c — GET /api/integrations/listmonk?campaign_id=X (email stats read).
 *
 * Gives the Email Strategist real campaign performance (sent / views /
 * clicks / bounces) to learn from, instead of firing drafts blind. 503 when
 * unconfigured; maps the Listmonk campaign object to a stats summary.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
// W91 — mock identity + resolveCredentials (env-mirroring, no fetch).
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => ({ id: "admin", email: "admin@staffd.com" }) }));
vi.mock("../../app/api/_lib/integrations/resolve", () => ({
  resolveCredentials: async () => {
    const url = process.env.LISTMONK_URL, key = process.env.LISTMONK_PASSWORD;
    return url && key ? { source: "operator", url, key, config: { username: process.env.LISTMONK_USERNAME || "listmonk" } } : null;
  },
}));

import { GET } from "../../app/api/integrations/listmonk/route";

function req(qs = "?campaign_id=7"): Request {
  return new Request(`https://staffd.test/api/integrations/listmonk${qs}`);
}

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/listmonk (FC-1c)", () => {
  it("returns 503 when Listmonk is not configured", async () => {
    vi.stubEnv("LISTMONK_URL", "");
    vi.stubEnv("LISTMONK_PASSWORD", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("returns a recent-campaigns LIST when no campaign_id (W80.1 Operations Home)", async () => {
    vi.stubEnv("LISTMONK_URL", "https://lm.example.test");
    vi.stubEnv("LISTMONK_PASSWORD", "pass");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { results: [
        { id: 7, name: "June blast", status: "finished", sent: 1000, views: 420, clicks: 85 },
      ] } }),
    })));
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0]).toMatchObject({ id: 7, name: "June blast", sent: 1000 });
  });

  it("maps the campaign object to a stats summary", async () => {
    vi.stubEnv("LISTMONK_URL", "https://lm.example.test");
    vi.stubEnv("LISTMONK_PASSWORD", "pass");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: { id: 7, name: "June blast", subject: "Hello", status: "finished", sent: 1000, views: 420, clicks: 85, bounces: 12 },
      }),
    })));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.campaign).toMatchObject({ id: 7, sent: 1000, views: 420, clicks: 85, bounces: 12 });
  });

  it("returns 502 on an upstream Listmonk error", async () => {
    vi.stubEnv("LISTMONK_URL", "https://lm.example.test");
    vi.stubEnv("LISTMONK_PASSWORD", "pass");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const res = await GET(req());
    expect(res.status).toBe(502);
  });
});
