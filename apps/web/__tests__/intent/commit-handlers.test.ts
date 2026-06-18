/**
 * W95.4a — intent commit handlers: STAFFD-native write + vendor mirror ENQUEUE
 * (Standard #20, no inline vendor calls) + Vault decision, per intent type.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const rec = vi.hoisted(() => ({ fn: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: rec.fn }));
vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { COMMIT_HANDLERS } from "../../app/api/_lib/intent/commit-handlers";

const ctx = { token: "tok", userId: "userA", source: "text" };
let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let existing: { id: string; twenty_record_id?: string } | null;
const idmap: Record<string, string> = { contacts: "c-1", interactions: "i-1", followups: "f-1", tasks: "t-1", leads: "l-1", expenses: "e-1", workflow_tasks: "wt-1" };

function setFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes("/contacts/records?") && method === "GET") return { ok: true, json: async () => ({ items: existing ? [existing] : [] }) };
    if (method === "POST") {
      const col = url.match(/\/collections\/([^/]+)\/records/)?.[1] ?? "x";
      return { ok: true, json: async () => ({ id: idmap[col] ?? "x-1" }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}
const created = (col: string) => calls.find((c) => c.url.includes(`/collections/${col}/records`) && c.method === "POST");
const enqueued = (sid: string) => calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST" && (c.body as { specialist_id?: string })?.specialist_id === sid);

beforeEach(() => { rec.fn.mockClear(); existing = null; setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("COMMIT_HANDLERS", () => {
  it("create_contact writes a contact and ENQUEUES the twenty mirror (no inline call)", async () => {
    const r = await COMMIT_HANDLERS.create_contact({ name: "Jane", email: "j@x.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "c-1", extra: { twenty_mirror_status: "pending" } });
    expect((created("contacts")!.body as { user: string }).user).toBe("userA");
    expect(enqueued("mirror_retry_worker")).toBeDefined();
    expect(rec.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "user_confirmed_fact" }));
  });

  it("log_interaction writes an interactions row", async () => {
    const r = await COMMIT_HANDLERS.log_interaction({ contact_name: "Jane", interaction_type: "call", notes: "pricing" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "i-1" });
    expect((created("interactions")!.body as { type: string }).type).toBe("call");
    expect(rec.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "interaction_logged" }));
  });

  it("schedule_followup writes a pending followup", async () => {
    const r = await COMMIT_HANDLERS.schedule_followup({ contact_name: "Jane", due_date: "2026-07-01" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "f-1" });
    expect((created("followups")!.body as { status: string }).status).toBe("pending");
  });

  it("add_to_email_list creates the contact when new and enqueues listmonk subscribe (on the bus)", async () => {
    const r = await COMMIT_HANDLERS.add_to_email_list({ email: "new@x.com", name: "New" }, ctx);
    expect(r.ok).toBe(true);
    expect(created("contacts")).toBeDefined();
    expect(enqueued("listmonk_subscribe_worker")).toBeDefined();
    expect((enqueued("listmonk_subscribe_worker")!.body as { input_payload: { email: string } }).input_payload.email).toBe("new@x.com");
  });

  it("add_to_email_list reuses an existing contact (no duplicate create)", async () => {
    existing = { id: "c-9", twenty_record_id: "tw-9" };
    const r = await COMMIT_HANDLERS.add_to_email_list({ email: "known@x.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "c-9" });
    expect(created("contacts")).toBeUndefined(); // found, not created
    expect(enqueued("listmonk_subscribe_worker")).toBeDefined();
  });

  it("create_task writes a task; missing title → 400", async () => {
    expect(await COMMIT_HANDLERS.create_task({ title: "Call accountant" }, ctx)).toMatchObject({ ok: true, record_id: "t-1" });
    expect(await COMMIT_HANDLERS.create_task({ notes: "no title" }, ctx)).toMatchObject({ ok: false, status: 400 });
  });

  it("capture_lead creates a contact + lead and enqueues the twenty mirror", async () => {
    const r = await COMMIT_HANDLERS.capture_lead({ name: "John", company: "Acme", interest_summary: "consulting" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "l-1", extra: { contact_id: "c-1" } });
    expect(created("leads")).toBeDefined();
    expect(enqueued("mirror_retry_worker")).toBeDefined();
  });

  it("update_contact patches an existing contact and enqueues a twenty UPDATE", async () => {
    existing = { id: "c-7", twenty_record_id: "tw-7" };
    const r = await COMMIT_HANDLERS.update_contact({ contact_identifier: "Jane", new_email: "jane@new.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "c-7" });
    expect(calls.some((c) => c.url.includes("/contacts/records/c-7") && c.method === "PATCH")).toBe(true);
    const task = enqueued("twenty_update_worker");
    expect((task!.body as { input_payload: { twenty_record_id: string } }).input_payload.twenty_record_id).toBe("tw-7");
  });

  it("update_contact 404s when no contact matches", async () => {
    existing = null;
    expect(await COMMIT_HANDLERS.update_contact({ contact_identifier: "Ghost", new_email: "x@y.com" }, ctx)).toMatchObject({ ok: false, status: 404 });
  });

  it("log_expense writes a numeric amount and marks billable when a client is named", async () => {
    const r = await COMMIT_HANDLERS.log_expense({ amount: "$45.50", category: "office", client_name: "Acme" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "e-1" });
    const body = created("expenses")!.body as { amount: number; billable: boolean; currency: string };
    expect(body.amount).toBe(45.5);
    expect(body.billable).toBe(true);
    expect(body.currency).toBe("USD");
  });

  it("log_expense rejects a non-numeric amount", async () => {
    expect(await COMMIT_HANDLERS.log_expense({ amount: "lots", category: "x" }, ctx)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("W95.4a new collections row-rule registration", () => {
  it("interactions/followups/tasks/leads/expenses are USER_OWNED", async () => {
    const { EXPECTED_COLLECTIONS, USER_OWNED_RULES } = await import("../../app/api/_lib/security/row-rules");
    for (const name of ["interactions", "followups", "tasks", "leads", "expenses"]) {
      const entry = EXPECTED_COLLECTIONS.find((e) => e.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.rules).toEqual(USER_OWNED_RULES);
    }
  });
});
