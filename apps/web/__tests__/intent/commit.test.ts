/**
 * W95.1 + W95.4a — POST /api/intent/commit: authenticates, dispatches by
 * intent_type to COMMIT_HANDLERS, audits, Responds. Vendor mirrors are
 * ENQUEUED by the handlers (Standard #20) — this route makes no inline vendor
 * calls. Per-handler behavior is covered in commit-handlers.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@acme.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const rec = vi.hoisted(() => ({ fn: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: rec.fn }));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { POST } from "../../app/api/intent/commit/route";

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
function setFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes("/contacts/records?") && method === "GET") return { ok: true, json: async () => ({ items: [] }) };
    if (method === "POST") {
      const col = url.match(/\/collections\/([^/]+)\/records/)?.[1] ?? "x";
      return { ok: true, json: async () => ({ id: col === "contacts" ? "c-1" : col === "tasks" ? "t-1" : "x-1" }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}
const req = (body: unknown) => new Request("https://t/api/intent/commit", { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { who.user = { id: "userA", email: "a@acme.com" }; rec.fn.mockClear(); setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/intent/commit", () => {
  it("dispatches create_contact → native write + enqueued mirror + audit (pending status)", async () => {
    const res = await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe", email: "jane@x.com" }, source: "text" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, intent_type: "create_contact", record_id: "c-1", twenty_mirror_status: "pending" });
    expect(calls.find((c) => c.url.includes("/contacts/records") && c.method === "POST")).toBeDefined();
    const mirror = calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");
    expect((mirror!.body as { specialist_id: string }).specialist_id).toBe("mirror_retry_worker");
    expect(calls.some((c) => c.url.includes("/super_admin_usage_log/records") && c.method === "POST")).toBe(true); // audit
  });

  it("dispatches a second intent type (create_task) through the same path", async () => {
    const res = await POST(req({ intent_type: "create_task", fields: { title: "Call accountant" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, intent_type: "create_task", record_id: "t-1" });
  });

  it("records a Vault decision on commit", async () => {
    await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe" } }));
    expect(rec.fn).toHaveBeenCalledTimes(1);
  });

  it("401 when unauthenticated", async () => {
    who.user = null;
    expect((await POST(req({ intent_type: "create_contact", fields: { name: "X" } }))).status).toBe(401);
  });

  it("400 on unsupported intent or missing required field", async () => {
    expect((await POST(req({ intent_type: "delete_universe", fields: {} }))).status).toBe(400);
    expect((await POST(req({ intent_type: "create_contact", fields: {} }))).status).toBe(400);
  });
});
