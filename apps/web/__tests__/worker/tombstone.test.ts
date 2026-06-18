/**
 * W95.5.1 — undo-mirror race guard. CREATE-type mirror workers must NOT create
 * a vendor record for a STAFFD row the user deleted (undo) or whose autopilot
 * fire was undone. twenty_update must push the CURRENT row state, not a stale
 * task payload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const tw = vi.hoisted(() => ({ create: vi.fn(async () => "tw-new"), update: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/twenty/client", () => ({
  TwentyClient: { forCustomer: () => ({ createPerson: tw.create, updatePerson: tw.update }) },
}));
const lm = vi.hoisted(() => ({ configured: true, add: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/listmonk/client", () => ({
  ListmonkClient: { get configured() { return lm.configured; }, forCustomer: () => ({ addSubscriber: lm.add }) },
}));
vi.mock("../../app/api/_lib/integrations/docuseal/client", () => ({ DocusealClient: { forCustomer: () => ({}) } }));
vi.mock("../../app/api/_lib/upload/extract", () => ({ extractKindFor: () => "text", extractText: async () => ({ ok: true, text: "t" }) }));
vi.mock("../../app/api/_lib/pb", () => ({ pbEscape: (s: string) => s }));

import { WORKER_HANDLERS } from "../../app/api/_lib/worker/handlers";

const ctx = { pb: "https://pb.test", adminToken: "tok", authHeaders: { Authorization: "tok", "Content-Type": "application/json" } };
function task(specialist: string, payload: Record<string, unknown>): any {
  return { id: "t", workflow_id: "", user: "userA", specialist_id: specialist, department_id: "system", input_payload: payload, status: "pending", depends_on: [], retry_count: 0 };
}

// Configurable PB: does the contacts row exist? is there an undone audit?
let rowExists: boolean;
let rowData: Record<string, unknown>;
let undonePresent: boolean;
function setFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/contacts/records/") && method === "GET") return { ok: rowExists, status: rowExists ? 200 : 404, json: async () => rowData };
    if (url.includes("/autopilot_audit_log/records?")) return { ok: true, json: async () => ({ items: undonePresent ? [{ id: "a1" }] : [] }) };
    return { ok: true, json: async () => ({}) };
  }));
}
beforeEach(() => { rowExists = true; rowData = { name: "Current", email: "cur@x.com", phone: "" }; undonePresent = false; tw.create.mockClear(); tw.update.mockClear(); lm.add.mockClear(); setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("mirror_retry_worker tombstone", () => {
  it("exits cleanly (tombstoned-deleted) when the source row was deleted — no vendor create", async () => {
    rowExists = false;
    const r = await WORKER_HANDLERS.mirror_retry_worker!(task("mirror_retry_worker", { vendor: "twenty", record_id: "c-1", fields: { name: "Jane" } }), ctx);
    expect(r.text).toBe("tombstoned-deleted");
    expect(tw.create).not.toHaveBeenCalled();
  });
  it("exits cleanly (tombstoned-undone) when the autopilot fire was undone", async () => {
    undonePresent = true;
    const r = await WORKER_HANDLERS.mirror_retry_worker!(task("mirror_retry_worker", { vendor: "twenty", record_id: "c-1", fields: { name: "Jane" } }), ctx);
    expect(r.text).toBe("tombstoned-undone");
    expect(tw.create).not.toHaveBeenCalled();
  });
  it("mirrors normally when the row is live", async () => {
    const r = await WORKER_HANDLERS.mirror_retry_worker!(task("mirror_retry_worker", { vendor: "twenty", record_id: "c-1", fields: { name: "Jane" } }), ctx);
    expect(r.text).toMatch(/mirrored/);
    expect(tw.create).toHaveBeenCalled();
  });
});

describe("listmonk_subscribe_worker tombstone", () => {
  it("exits cleanly when the source contact was deleted — no subscribe", async () => {
    rowExists = false;
    const r = await WORKER_HANDLERS.listmonk_subscribe_worker!(task("listmonk_subscribe_worker", { email: "j@x.com", record_id: "c-1" }), ctx);
    expect(r.text).toBe("tombstoned-deleted");
    expect(lm.add).not.toHaveBeenCalled();
  });
  it("exits cleanly when the autopilot fire was undone — no subscribe", async () => {
    undonePresent = true;
    const r = await WORKER_HANDLERS.listmonk_subscribe_worker!(task("listmonk_subscribe_worker", { email: "j@x.com", record_id: "c-1" }), ctx);
    expect(r.text).toBe("tombstoned-undone");
    expect(lm.add).not.toHaveBeenCalled();
  });
});

describe("twenty_update_worker uses current row state", () => {
  it("pushes the CURRENT row values (post-undo restore), not the stale payload", async () => {
    rowData = { name: "Restored", email: "restored@x.com", phone: "555" };
    await WORKER_HANDLERS.twenty_update_worker!(task("twenty_update_worker", { record_id: "c-1", twenty_record_id: "tw-1", fields: { email: "stale@x.com" } }), ctx);
    expect(tw.update).toHaveBeenCalledWith("tw-1", { name: "Restored", email: "restored@x.com", phone: "555" });
  });
  it("tombstones (no update) when the row was deleted", async () => {
    rowExists = false;
    const r = await WORKER_HANDLERS.twenty_update_worker!(task("twenty_update_worker", { record_id: "c-1", twenty_record_id: "tw-1", fields: { email: "x" } }), ctx);
    expect(r.text).toBe("tombstoned-deleted");
    expect(tw.update).not.toHaveBeenCalled();
  });
});
