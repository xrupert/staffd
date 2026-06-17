/**
 * W95.1 — POST /api/intent/commit: STAFFD-native write + tenant-tagged Twenty
 * mirror + Vault enrichment, graceful on vendor-mirror failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@acme.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const tc = vi.hoisted(() => ({ createPerson: vi.fn(async () => "tw-1" as string | null), configured: true }));
vi.mock("../../app/api/_lib/integrations/twenty/client", () => ({
  TwentyClient: { get configured() { return tc.configured; }, forCustomer: () => ({ createPerson: tc.createPerson }) },
}));

const rec = vi.hoisted(() => ({ fn: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: rec.fn }));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { POST } from "../../app/api/intent/commit/route";

let calls: { url: string; method: string; body: unknown }[];
function setFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    if (url.includes("/contacts/records") && method === "POST") return { ok: true, json: async () => ({ id: "c-1" }) };
    return { ok: true, json: async () => ({}) };
  }));
}
const req = (body: unknown) => new Request("https://t/api/intent/commit", { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { who.user = { id: "userA", email: "a@acme.com" }; tc.configured = true; tc.createPerson.mockResolvedValue("tw-1"); rec.fn.mockClear(); setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/intent/commit", () => {
  it("writes the STAFFD-native contact (scoped to the authed user) and mirrors to Twenty", async () => {
    const res = await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe", email: "jane@x.com" }, source: "text" }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, record_id: "c-1", twenty_record_id: "tw-1", twenty_mirror_status: "synced" });
    const create = calls.find((c) => c.url.includes("/contacts/records") && c.method === "POST");
    expect((create!.body as { user: string }).user).toBe("userA"); // tenant-scoped write
    expect(tc.createPerson).toHaveBeenCalledWith(expect.objectContaining({ name: "Jane Doe" }));
  });

  it("records a Vault decision on commit", async () => {
    await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe" } }));
    expect(rec.fn).toHaveBeenCalledTimes(1);
    expect(rec.fn.mock.calls[0]![0]).toMatchObject({ userId: "userA", decision_kind: "user_confirmed_fact" });
  });

  it("SUCCEEDS even when the Twenty mirror fails (native row persists, status=error)", async () => {
    tc.createPerson.mockResolvedValue(null);
    const res = await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe" } }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, record_id: "c-1", twenty_record_id: null, twenty_mirror_status: "error" });
  });

  it("still succeeds when the Twenty client throws", async () => {
    tc.createPerson.mockRejectedValue(new Error("network"));
    const res = await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).twenty_mirror_status).toBe("error");
  });

  it("W95.2 — enqueues a mirror_retry_worker task (tenant-scoped) when the Twenty mirror fails", async () => {
    tc.createPerson.mockResolvedValue(null); // mirror error
    await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe", email: "j@x.com", phone: "555" } }));
    const enqueue = calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");
    expect(enqueue).toBeDefined();
    const body = enqueue!.body as { specialist_id: string; user: string; department_id: string; input_payload: { vendor: string; record_id: string; fields: Record<string, string> } };
    expect(body.specialist_id).toBe("mirror_retry_worker");
    expect(body.user).toBe("userA"); // retry stays scoped to the same tenant
    expect(body.input_payload).toMatchObject({ vendor: "twenty", record_id: "c-1", fields: { name: "Jane Doe", email: "j@x.com", phone: "555" } });
  });

  it("W95.2 — does NOT enqueue a retry task when the mirror succeeds", async () => {
    tc.createPerson.mockResolvedValue("tw-1"); // synced
    await POST(req({ intent_type: "create_contact", fields: { name: "Jane Doe" } }));
    expect(calls.some((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST")).toBe(false);
  });

  it("401 when unauthenticated", async () => {
    who.user = null;
    expect((await POST(req({ intent_type: "create_contact", fields: { name: "X" } }))).status).toBe(401);
  });

  it("400 on unsupported intent or missing name", async () => {
    expect((await POST(req({ intent_type: "delete_universe", fields: {} }))).status).toBe(400);
    expect((await POST(req({ intent_type: "create_contact", fields: {} }))).status).toBe(400);
  });
});
