/**
 * W95.5 — COMMIT_HANDLERS.undo + disable_autopilot. Reverses create/update
 * autopilot fires within the window; rejects expired/already-undone/foreign.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
  getAdminToken: async () => "tok",
}));

import { COMMIT_HANDLERS } from "../../app/api/_lib/intent/commit-handlers";

const ctx = { token: "tok", userId: "userA", source: "ui" };
const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let audit: Record<string, unknown> | null;
let targetRow: Record<string, unknown> | null;
function setFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes("/autopilot_audit_log/records/") && method === "GET") return { ok: !!audit, status: audit ? 200 : 404, json: async () => audit };
    if (/\/(contacts|leads|expenses)\/records\/[^?]+$/.test(url) && method === "GET") return { ok: !!targetRow, status: targetRow ? 200 : 404, json: async () => targetRow };
    if (url.includes("/autopilot_prefs/records?")) return { ok: true, json: async () => ({ items: [] }) }; // policy find → default
    return { ok: true, json: async () => ({ id: "x" }) };
  }));
}
const enq = (sid: string) => calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST" && (c.body as { specialist_id?: string })?.specialist_id === sid);

beforeEach(() => { audit = null; targetRow = { user: "userA" }; setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("undo handler", () => {
  it("reverses a create: deletes the native row + enqueues the vendor delete", async () => {
    audit = { id: "a1", user: "userA", intent_type: "create_contact", target_collection: "contacts", target_record_id: "c-1", undo_window_expires_at: future(), undone_at: "" };
    targetRow = { user: "userA", twenty_record_id: "tw-1" };
    const r = await COMMIT_HANDLERS.undo!({ audit_row_id: "a1" }, ctx);
    expect(r).toMatchObject({ ok: true });
    expect(calls.some((c) => c.url.includes("/contacts/records/c-1") && c.method === "DELETE")).toBe(true);
    expect(enq("twenty_delete_worker")).toBeDefined();
    expect(calls.some((c) => c.url.includes("/autopilot_audit_log/records/a1") && c.method === "PATCH" && !!c.body?.undone_at)).toBe(true);
  });

  it("reverses an update: restores previous_state + enqueues a vendor update", async () => {
    audit = { id: "a2", user: "userA", intent_type: "update_contact", target_collection: "contacts", target_record_id: "c-2", previous_state: { email: "old@x.com" }, undo_window_expires_at: future(), undone_at: "" };
    targetRow = { user: "userA", twenty_record_id: "tw-2" };
    await COMMIT_HANDLERS.undo!({ audit_row_id: "a2" }, ctx);
    const restore = calls.find((c) => c.url.includes("/contacts/records/c-2") && c.method === "PATCH");
    expect(restore!.body).toMatchObject({ email: "old@x.com" });
    expect(enq("twenty_update_worker")).toBeDefined();
  });

  it("rejects an expired window (410)", async () => {
    audit = { id: "a3", user: "userA", intent_type: "create_contact", target_collection: "contacts", target_record_id: "c-1", undo_window_expires_at: past(), undone_at: "" };
    expect(await COMMIT_HANDLERS.undo!({ audit_row_id: "a3" }, ctx)).toMatchObject({ ok: false, status: 410 });
  });

  it("rejects an already-undone row (409)", async () => {
    audit = { id: "a4", user: "userA", intent_type: "create_contact", target_collection: "contacts", target_record_id: "c-1", undo_window_expires_at: future(), undone_at: new Date().toISOString() };
    expect(await COMMIT_HANDLERS.undo!({ audit_row_id: "a4" }, ctx)).toMatchObject({ ok: false, status: 409 });
  });

  it("404s when the audit row is missing / not owned", async () => {
    audit = null;
    expect(await COMMIT_HANDLERS.undo!({ audit_row_id: "nope" }, ctx)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("disable_autopilot handler", () => {
  it("turns autopilot off for the named intent", async () => {
    const r = await COMMIT_HANDLERS.disable_autopilot!({ intent_type: "create_contact" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "create_contact" });
  });
  it("400s without an intent_type", async () => {
    expect(await COMMIT_HANDLERS.disable_autopilot!({}, ctx)).toMatchObject({ ok: false, status: 400 });
  });
});
