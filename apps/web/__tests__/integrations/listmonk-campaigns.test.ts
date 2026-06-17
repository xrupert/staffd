/**
 * W80.2 — Listmonk native-surface capabilities: lists read + send/schedule.
 * Covers the list-view data, the augmentation handoff's send path, and a
 * Listmonk failure mode. Super-admin gated; outcomes recorded on send.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// W91 — mock identity + resolveCredentials (env-mirroring, no fetch).
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => ({ id: "admin", email: "admin@staffd.com" }) }));
vi.mock("../../app/api/_lib/integrations/resolve", () => ({
  resolveCredentials: async () => {
    const url = process.env.LISTMONK_URL, key = process.env.LISTMONK_PASSWORD;
    return url && key ? { source: "operator", url, key, config: { username: process.env.LISTMONK_USERNAME || "listmonk" } } : null;
  },
}));
const recordMock = vi.hoisted(() => ({ fn: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: recordMock.fn }));

import { GET, PUT } from "../../app/api/integrations/listmonk/route";

function get(qs: string): Request { return new Request(`https://t/api/integrations/listmonk${qs}`); }
function put(body: unknown): Request {
  return new Request("https://t/api/integrations/listmonk", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  recordMock.fn.mockClear();
  vi.stubEnv("LISTMONK_URL", "https://lm.example.test");
  vi.stubEnv("LISTMONK_PASSWORD", "pass");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Listmonk lists read (W80.2)", () => {
  it("maps lists for the compose audience picker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { results: [{ id: 1, name: "Newsletter", subscriber_count: 1200 }] } }) })));
    const res = await GET(get("?resource=lists"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lists).toHaveLength(1);
    expect(data.lists[0]).toMatchObject({ id: 1, name: "Newsletter", subscribers: 1200 });
  });

  it("returns 502 when the lists upstream fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const res = await GET(get("?resource=lists"));
    expect(res.status).toBe(502);
  });
});

describe("Listmonk enriched list (W80.2)", () => {
  it("includes recipients, open rate, and dates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { results: [
      { id: 9, name: "June", status: "finished", sent: 1000, to_send: 1000, views: 250, clicks: 40, send_at: "2026-06-01", created_at: "2026-05-30" },
    ] } }) })));
    const res = await GET(get(""));
    const data = await res.json();
    expect(data.campaigns[0]).toMatchObject({ id: 9, toSend: 1000, openRate: 25, sendAt: "2026-06-01" });
  });
});

describe("Listmonk send/schedule (W80.2)", () => {
  it("send → flips status to running and records an outcome", async () => {
    const fetchFn = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({}), text: async () => "" }));
    vi.stubGlobal("fetch", fetchFn);
    const res = await PUT(put({ campaignId: 9, action: "send", userId: "u1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("running");
    expect(fetchFn.mock.calls[0]![0]).toContain("/campaigns/9/status");
    expect(recordMock.fn).toHaveBeenCalledTimes(1);
    expect(recordMock.fn.mock.calls[0]![0]).toMatchObject({ decision_kind: "campaign_sent" });
  });

  it("schedule → sets send_at then status scheduled", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({}), text: async () => "" }));
    vi.stubGlobal("fetch", fetchFn);
    const res = await PUT(put({ campaignId: 9, action: "schedule", sendAt: "2026-07-01T09:00:00Z" }));
    expect(res.status).toBe(200);
    // Two calls: PUT campaign (send_at), then PUT status.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("400 when campaignId or action is missing", async () => {
    const res = await PUT(put({ campaignId: 9 }));
    expect(res.status).toBe(400);
  });

  it("400 on an unsupported action", async () => {
    const res = await PUT(put({ campaignId: 9, action: "explode" }));
    expect(res.status).toBe(400);
  });

  it("502 when the status update upstream fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const res = await PUT(put({ campaignId: 9, action: "send" }));
    expect(res.status).toBe(502);
  });
});
