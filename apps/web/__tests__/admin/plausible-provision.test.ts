/**
 * W95.6.y — POST/DELETE /api/admin/plausible/[userId] (operator provisioning).
 * Super-admin gated. POST sets businesses.plausible_site_id; DELETE clears it.
 * 404 when the user has no business row. The usage roster now carries the
 * per-user provisioning state (plausibleSiteId).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ ok: true }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (!adminMock.ok) { const e = new Error("forbidden") as Error & { __auth: boolean }; e.__auth = true; throw e; }
    return { id: "admin", email: "chris.rupert@cybridagency.com" };
  }),
  toAuthErrorResponse: () => Response.json({ error: "forbidden" }, { status: 403 }),
}));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { POST, DELETE } from "../../app/api/admin/plausible/[userId]/route";

const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
let hasBiz: boolean;
function stub() {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url: String(url), method, body });
    if (url.includes("/businesses/records?")) return { ok: true, status: 200, json: async () => ({ items: hasBiz ? [{ id: "biz-1" }] : [] }) };
    if (url.includes("/businesses/records/")) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

const post = (userId: string, site_id?: string) =>
  POST(new Request("https://t/api/admin/plausible/" + userId, { method: "POST", body: JSON.stringify({ site_id }) }), { params: Promise.resolve({ userId }) });
const del = (userId: string) =>
  DELETE(new Request("https://t/api/admin/plausible/" + userId, { method: "DELETE" }), { params: Promise.resolve({ userId }) });

beforeEach(() => { adminMock.ok = true; hasBiz = true; stub(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST/DELETE /api/admin/plausible/[userId] (W95.6.y)", () => {
  it("rejects a non-super-admin", async () => {
    adminMock.ok = false;
    expect((await post("u1", "acme.com")).status).toBe(403);
  });

  it("POST sets plausible_site_id on the business row", async () => {
    const res = await post("u1", "acme.com");
    expect(res.status).toBe(200);
    const patch = calls.find((c) => c.url.includes("/businesses/records/biz-1") && c.method === "PATCH");
    expect((patch!.body as { plausible_site_id: string }).plausible_site_id).toBe("acme.com");
  });

  it("POST with an empty site_id is rejected (400)", async () => {
    expect((await post("u1", "   ")).status).toBe(400);
  });

  it("DELETE clears plausible_site_id", async () => {
    const res = await del("u1");
    expect(res.status).toBe(200);
    const patch = calls.find((c) => c.url.includes("/businesses/records/biz-1") && c.method === "PATCH");
    expect((patch!.body as { plausible_site_id: string }).plausible_site_id).toBe("");
  });

  it("404 when the user has no business row", async () => {
    hasBiz = false;
    expect((await post("u1", "acme.com")).status).toBe(404);
  });
});
