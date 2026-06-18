/**
 * W95.7 — ListmonkClient campaign methods (list-scoped) + GET/POST/PUT
 * /api/front-desk/campaigns. The Email Campaigns surface is per-customer:
 * reads/writes are scoped to the customer's own list (leak-guard), drafts
 * target only that list, and a campaign on another tenant's list is invisible.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/integrations/identity", () => ({
  whoAmI: async (req: Request) => (req.headers.get("authorization") ? { id: "userA", email: "a@cust.com" } : null),
}));
const recordMock = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: recordMock.fn }));

import { ListmonkClient } from "../../app/api/_lib/integrations/listmonk/client";
import * as clientMod from "../../app/api/_lib/integrations/listmonk/client";
import { GET, POST, PUT } from "../../app/api/front-desk/campaigns/route";

const MY_LIST = 7;
const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
// Backend campaigns: one on MY_LIST, one on someone else's list (8).
let campaigns: { id: number; name: string; status: string; lists: { id: number }[] }[];

function setFetch() {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url: String(url), method, body });
    // ensureList → find my list by name
    if (url.includes("/api/lists") && method === "GET") return { ok: true, status: 200, json: async () => ({ data: { results: [{ id: MY_LIST, name: "staffd-userA" }] } }) };
    // list campaigns
    if (url.match(/\/api\/campaigns\?/) && method === "GET") return { ok: true, status: 200, json: async () => ({ data: { results: campaigns } }) };
    // single campaign
    const m = url.match(/\/api\/campaigns\/(\d+)$/);
    if (m && method === "GET") { const c = campaigns.find((x) => x.id === Number(m[1])); return { ok: !!c, status: c ? 200 : 404, json: async () => ({ data: c }) }; }
    // create
    if (url.endsWith("/api/campaigns") && method === "POST") return { ok: true, status: 200, json: async () => ({ data: { id: 99 } }) };
    // status update
    if (url.match(/\/api\/campaigns\/\d+\/status/) && method === "PUT") return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

beforeEach(() => {
  campaigns = [
    { id: 1, name: "Mine", status: "finished", lists: [{ id: MY_LIST }] },
    { id: 2, name: "Theirs", status: "finished", lists: [{ id: 8 }] },
  ];
  recordMock.fn.mockClear();
  vi.stubEnv("LISTMONK_URL", "https://lm.test"); vi.stubEnv("LISTMONK_PASSWORD", "p");
  setFetch();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const req = (qs = "") => new Request(`https://t/api/front-desk/campaigns${qs}`, { headers: { authorization: "tok" } });

describe("ListmonkClient campaigns (W95.7, list-scoped)", () => {
  it("does NOT export a raw HTTP helper (structural guard)", () => {
    expect(Object.keys(clientMod)).toEqual(["ListmonkClient"]);
  });

  it("listCampaigns returns ONLY campaigns targeting this customer's list", async () => {
    const list = await ListmonkClient.forCustomer("userA").listCampaigns();
    expect(list.map((c) => c.name)).toEqual(["Mine"]); // "Theirs" (list 8) excluded
  });

  it("getCampaign refuses a campaign on another tenant's list (leak-guard)", async () => {
    const c = ListmonkClient.forCustomer("userA");
    expect(await c.getCampaign(1)).not.toBeNull();
    expect(await c.getCampaign(2)).toBeNull();
  });

  it("createDraft targets ONLY this customer's list", async () => {
    await ListmonkClient.forCustomer("userA").createDraft({ subject: "Hi", body: "Body" });
    const create = calls.find((c) => c.url.endsWith("/api/campaigns") && c.method === "POST");
    expect((create!.body as { lists: number[] }).lists).toEqual([MY_LIST]);
  });

  it("setStatus refuses to act on a campaign the customer does not own", async () => {
    const c = ListmonkClient.forCustomer("userA");
    expect(await c.setStatus(2, "send")).toBe(false); // list 8 — not owned
    expect(calls.some((x) => x.url.includes("/api/campaigns/2/status"))).toBe(false);
  });
});

describe("GET/POST/PUT /api/front-desk/campaigns (W95.7)", () => {
  it("401 without auth", async () => {
    const res = await GET(new Request("https://t/api/front-desk/campaigns"));
    expect(res.status).toBe(401);
  });

  it("GET lists only the customer's campaigns", async () => {
    const d = await (await GET(req("?limit=10"))).json();
    expect(d.connected).toBe(true);
    expect(d.campaigns.map((c: { name: string }) => c.name)).toEqual(["Mine"]);
  });

  it("GET ?campaign_id leak-guards a foreign campaign to null", async () => {
    expect((await (await GET(req("?campaign_id=2"))).json()).campaign).toBeNull();
  });

  it("POST creates a draft and records a vault outcome", async () => {
    const res = await POST(new Request("https://t/api/front-desk/campaigns", { method: "POST", headers: { authorization: "tok", "content-type": "application/json" }, body: JSON.stringify({ subject: "S", body: "B" }) }));
    expect((await res.json())).toMatchObject({ success: true, campaignId: 99 });
    expect(recordMock.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "campaign_drafted" }));
  });

  it("POST 400 without subject/body", async () => {
    const res = await POST(new Request("https://t/api/front-desk/campaigns", { method: "POST", headers: { authorization: "tok", "content-type": "application/json" }, body: JSON.stringify({ subject: "only" }) }));
    expect(res.status).toBe(400);
  });

  it("PUT send on an owned campaign records a send outcome", async () => {
    const res = await PUT(new Request("https://t/api/front-desk/campaigns", { method: "PUT", headers: { authorization: "tok", "content-type": "application/json" }, body: JSON.stringify({ campaignId: 1, action: "send" }) }));
    expect((await res.json())).toMatchObject({ success: true });
    expect(recordMock.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "campaign_sent" }));
  });

  it("PUT 404 when acting on a non-owned campaign", async () => {
    const res = await PUT(new Request("https://t/api/front-desk/campaigns", { method: "PUT", headers: { authorization: "tok", "content-type": "application/json" }, body: JSON.stringify({ campaignId: 2, action: "send" }) }));
    expect(res.status).toBe(404);
  });
});
