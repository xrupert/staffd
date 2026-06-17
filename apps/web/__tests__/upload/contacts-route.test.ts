/**
 * W95.3 — POST /api/upload/contacts: CSV → STAFFD-native contacts rows +
 * async Twenty mirror enqueue (W71 task bus) + best-effort Listmonk add.
 * Vendor outcomes never fail a native row.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const lm = vi.hoisted(() => ({ configured: true, addSubscriber: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/listmonk/client", () => ({
  ListmonkClient: { get configured() { return lm.configured; }, forCustomer: () => ({ addSubscriber: lm.addSubscriber }) },
}));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
}));

import { POST } from "../../app/api/upload/contacts/route";

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
function setFetch() {
  calls = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    if (url.includes("/contacts/records") && method === "POST") return { ok: true, json: async () => ({ id: `c-${++n}` }) };
    return { ok: true, json: async () => ({}) };
  }));
}
function csvReq(csv: string) {
  const fd = new FormData();
  fd.append("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  return new Request("https://t/api/upload/contacts", { method: "POST", body: fd });
}

beforeEach(() => { who.user = { id: "userA", email: "a@x.com" }; lm.configured = true; lm.addSubscriber.mockClear(); lm.addSubscriber.mockResolvedValue(true); setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/upload/contacts", () => {
  it("writes a native contacts row per CSV row (scoped to the owner) and enqueues an async Twenty mirror each", async () => {
    const res = await POST(csvReq("name,email\nJane,jane@x.com\nBob,bob@x.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 2, succeeded: 2, failed: 0 });

    const writes = calls.filter((c) => c.url.includes("/contacts/records") && c.method === "POST");
    expect(writes).toHaveLength(2);
    expect((writes[0]!.body as { user: string }).user).toBe("userA");

    const mirrors = calls.filter((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");
    expect(mirrors).toHaveLength(2);
    expect((mirrors[0]!.body as { specialist_id: string; input_payload: { vendor: string } }).specialist_id).toBe("mirror_retry_worker");
    expect((mirrors[0]!.body as { input_payload: { vendor: string } }).input_payload.vendor).toBe("twenty");
  });

  it("adds each emailable contact to the customer's Listmonk list", async () => {
    await POST(csvReq("name,email\nJane,jane@x.com\nNoEmail,"));
    expect(lm.addSubscriber).toHaveBeenCalledTimes(1); // only the row with an email
    expect(lm.addSubscriber).toHaveBeenCalledWith({ email: "jane@x.com", name: "Jane" });
  });

  it("a Listmonk failure does NOT fail the native write", async () => {
    lm.addSubscriber.mockRejectedValue(new Error("listmonk down"));
    const res = await POST(csvReq("name,email\nJane,jane@x.com"));
    expect(await res.json()).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it("counts parse errors as failed without dropping good rows", async () => {
    const res = await POST(csvReq("name,email\nJane,j@x.com\n,orphan@x.com\nBob,b@x.com"));
    const d = await res.json();
    expect(d).toMatchObject({ total: 3, succeeded: 2, failed: 1 });
    expect(d.errors.some((e: { reason: string }) => /name/i.test(e.reason))).toBe(true);
  });

  it("422 when the CSV header has no name column", async () => {
    expect((await POST(csvReq("foo,bar\n1,2"))).status).toBe(422);
  });

  it("401 when unauthenticated; 400 when no file", async () => {
    who.user = null;
    expect((await POST(csvReq("name\nJane"))).status).toBe(401);
    who.user = { id: "userA", email: "a@x.com" };
    expect((await POST(new Request("https://t/api/upload/contacts", { method: "POST", body: new FormData() }))).status).toBe(400);
  });
});
