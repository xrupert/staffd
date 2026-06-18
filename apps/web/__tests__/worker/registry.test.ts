/**
 * W95.4a — worker-handler registry: dispatch keys, isWorkerTask, and the two
 * new handlers (listmonk_subscribe, twenty_update). The existing two handlers'
 * behavior is proven unchanged by the untouched mirror-retry / document-
 * extraction route tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const lm = vi.hoisted(() => ({ configured: true, add: vi.fn(async () => true), remove: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/listmonk/client", () => ({
  ListmonkClient: { get configured() { return lm.configured; }, forCustomer: () => ({ addSubscriber: lm.add, removeSubscriber: lm.remove }) },
}));
const tw = vi.hoisted(() => ({ update: vi.fn(async () => true), del: vi.fn(async () => true) }));
vi.mock("../../app/api/_lib/integrations/twenty/client", () => ({
  TwentyClient: { forCustomer: () => ({ updatePerson: tw.update, createPerson: async () => "x", deletePerson: tw.del }) },
}));
vi.mock("../../app/api/_lib/upload/extract", () => ({ extractKindFor: () => "text", extractText: async () => ({ ok: true, text: "t" }) }));
const ds = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 42 }) as { id: number } | null) }));
vi.mock("../../app/api/_lib/integrations/docuseal/client", () => ({ DocusealClient: { forCustomer: () => ({ createSubmission: ds.create }) } }));

import { WORKER_HANDLERS, isWorkerTask } from "../../app/api/_lib/worker/handlers";

const ctx = { pb: "https://pb.test", adminToken: "tok", authHeaders: { Authorization: "tok", "Content-Type": "application/json" } };
function task(specialist: string, payload: Record<string, unknown>): any {
  return { id: "t", workflow_id: "", user: "userA", specialist_id: specialist, department_id: "system", input_payload: payload, status: "pending", depends_on: [], retry_count: 0 };
}
let calls: { url: string; method: string }[];
beforeEach(() => { lm.configured = true; lm.add.mockClear(); lm.add.mockResolvedValue(true); lm.remove.mockClear(); lm.remove.mockResolvedValue(true); tw.update.mockClear(); tw.update.mockResolvedValue(true); tw.del.mockClear(); tw.del.mockResolvedValue(true); calls = []; vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method ?? "GET" }); return { ok: true, json: async () => ({}) }; })); });
afterEach(() => vi.unstubAllGlobals());

describe("worker registry", () => {
  it("registers exactly the known handler keys", () => {
    expect(Object.keys(WORKER_HANDLERS).sort()).toEqual([
      "document_extraction_worker", "docuseal_send_worker", "docuseal_void_worker",
      "listmonk_subscribe_worker", "listmonk_unsubscribe_worker", "mirror_retry_worker",
      "twenty_delete_worker", "twenty_update_worker",
    ]);
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

describe("undo reversal handlers (W95.5)", () => {
  it("twenty_delete_worker deletes the person", async () => {
    const r = await WORKER_HANDLERS.twenty_delete_worker!(task("twenty_delete_worker", { twenty_record_id: "tw-1" }), ctx);
    expect(tw.del).toHaveBeenCalledWith("tw-1");
    expect(r.text).toMatch(/deleted/);
  });
  it("twenty_delete_worker throws on failure (W71 retry)", async () => {
    tw.del.mockResolvedValue(false);
    await expect(WORKER_HANDLERS.twenty_delete_worker!(task("twenty_delete_worker", { twenty_record_id: "tw-1" }), ctx)).rejects.toThrow();
  });
  it("listmonk_unsubscribe_worker removes the subscriber", async () => {
    const r = await WORKER_HANDLERS.listmonk_unsubscribe_worker!(task("listmonk_unsubscribe_worker", { email: "j@x.com" }), ctx);
    expect(lm.remove).toHaveBeenCalledWith("j@x.com");
    expect(r.text).toMatch(/unsubscribed/);
  });
  it("docuseal_void_worker is a stub that throws not-implemented", async () => {
    await expect(WORKER_HANDLERS.docuseal_void_worker!(task("docuseal_void_worker", {}), ctx)).rejects.toThrow(/not yet implemented/i);
  });
});

describe("docuseal_send_worker", () => {
  function dsFetch() {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/documents/records/") && method === "GET") return { ok: true, json: async () => ({ id: "d-1" }) };
      return { ok: true, json: async () => ({}) };
    });
  }
  it("creates a tenant-tagged submission and stashes the submission id on the document", async () => {
    vi.stubEnv("DOCUSEAL_TEMPLATE_ID", "5");
    const f = dsFetch(); vi.stubGlobal("fetch", f);
    ds.create.mockResolvedValue({ id: 42 });
    const r = await WORKER_HANDLERS.docuseal_send_worker!(task("docuseal_send_worker", { document_id: "d-1", signer_email: "s@x.com" }), ctx);
    expect(r.text).toMatch(/signature-sent:42/);
    expect(ds.create).toHaveBeenCalledWith(expect.objectContaining({ templateId: 5, signerEmail: "s@x.com" }));
    const patch = f.mock.calls.find((c) => String(c[0]).includes("/documents/records/d-1") && (c[1] as RequestInit)?.method === "PATCH");
    expect(JSON.parse((patch![1] as RequestInit).body as string)).toMatchObject({ docuseal_submission_id: "42" });
    vi.unstubAllEnvs();
  });
  it("throws when DOCUSEAL_TEMPLATE_ID is not configured", async () => {
    vi.stubEnv("DOCUSEAL_TEMPLATE_ID", "");
    vi.stubGlobal("fetch", dsFetch());
    await expect(WORKER_HANDLERS.docuseal_send_worker!(task("docuseal_send_worker", { document_id: "d-1", signer_email: "s@x.com" }), ctx)).rejects.toThrow(/template/i);
    vi.unstubAllEnvs();
  });
  it("throws when the submission fails (W71 retry)", async () => {
    vi.stubEnv("DOCUSEAL_TEMPLATE_ID", "5");
    vi.stubGlobal("fetch", dsFetch());
    ds.create.mockResolvedValue(null);
    await expect(WORKER_HANDLERS.docuseal_send_worker!(task("docuseal_send_worker", { document_id: "d-1", signer_email: "s@x.com" }), ctx)).rejects.toThrow();
    vi.unstubAllEnvs();
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
