/**
 * W95.4a — worker-handler registry: dispatch keys, isWorkerTask, and the two
 * new handlers (listmonk_subscribe, twenty_update). The existing two handlers'
 * behavior is proven unchanged by the untouched mirror-retry / document-
 * extraction route tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const lm = vi.hoisted(() => ({ configured: true, add: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/listmonk/client", () => ({
  ListmonkClient: { get configured() { return lm.configured; }, forCustomer: () => ({ addSubscriber: lm.add }) },
}));
const tw = vi.hoisted(() => ({ update: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/twenty/client", () => ({
  TwentyClient: { forCustomer: () => ({ updatePerson: tw.update, createPerson: async () => "x" }) },
}));
vi.mock("../../app/api/_lib/upload/extract", () => ({ extractKindFor: () => "text", extractText: async () => ({ ok: true, text: "t" }) }));

import { WORKER_HANDLERS, isWorkerTask } from "../../app/api/_lib/worker/handlers";

const ctx = { pb: "https://pb.test", adminToken: "tok", authHeaders: { Authorization: "tok", "Content-Type": "application/json" } };
function task(specialist: string, payload: Record<string, unknown>): any {
  return { id: "t", workflow_id: "", user: "userA", specialist_id: specialist, department_id: "system", input_payload: payload, status: "pending", depends_on: [], retry_count: 0 };
}
let calls: { url: string; method: string }[];
beforeEach(() => { lm.configured = true; lm.add.mockClear(); lm.add.mockResolvedValue(true); tw.update.mockClear(); tw.update.mockResolvedValue(true); calls = []; vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method ?? "GET" }); return { ok: true, json: async () => ({}) }; })); });
afterEach(() => vi.unstubAllGlobals());

describe("worker registry", () => {
  it("registers exactly the known handler keys", () => {
    expect(Object.keys(WORKER_HANDLERS).sort()).toEqual(["document_extraction_worker", "listmonk_subscribe_worker", "mirror_retry_worker", "twenty_update_worker"]);
  });
  it("isWorkerTask is true for known specialist_ids, false otherwise", () => {
    expect(isWorkerTask("mirror_retry_worker")).toBe(true);
    expect(isWorkerTask("twenty_update_worker")).toBe(true);
    expect(isWorkerTask("some_real_specialist")).toBe(false);
    expect(isWorkerTask(null)).toBe(false);
  });
});

describe("listmonk_subscribe_worker", () => {
  it("subscribes the contact and resolves", async () => {
    const r = await WORKER_HANDLERS.listmonk_subscribe_worker!(task("listmonk_subscribe_worker", { email: "j@x.com", name: "Jane" }), ctx);
    expect(lm.add).toHaveBeenCalledWith({ email: "j@x.com", name: "Jane" });
    expect(r.text).toMatch(/subscribed/);
  });
  it("throws on a failed subscribe so W71 retries", async () => {
    lm.add.mockResolvedValue(false);
    await expect(WORKER_HANDLERS.listmonk_subscribe_worker!(task("listmonk_subscribe_worker", { email: "j@x.com" }), ctx)).rejects.toThrow();
  });
});

describe("twenty_update_worker", () => {
  it("pushes the update and patches the contact mirror status", async () => {
    await WORKER_HANDLERS.twenty_update_worker!(task("twenty_update_worker", { record_id: "c-1", twenty_record_id: "tw-1", fields: { email: "new@x.com" } }), ctx);
    expect(tw.update).toHaveBeenCalledWith("tw-1", { email: "new@x.com" });
    expect(calls.some((c) => c.url.includes("/contacts/records/c-1") && c.method === "PATCH")).toBe(true);
  });
  it("is a no-op (no throw) when the contact was never mirrored", async () => {
    const r = await WORKER_HANDLERS.twenty_update_worker!(task("twenty_update_worker", { record_id: "c-1", twenty_record_id: "", fields: {} }), ctx);
    expect(tw.update).not.toHaveBeenCalled();
    expect(r.text).toMatch(/no mirror/);
  });
  it("throws when the vendor update fails", async () => {
    tw.update.mockResolvedValue(false);
    await expect(WORKER_HANDLERS.twenty_update_worker!(task("twenty_update_worker", { record_id: "c-1", twenty_record_id: "tw-1", fields: { email: "x" } }), ctx)).rejects.toThrow();
  });
});
