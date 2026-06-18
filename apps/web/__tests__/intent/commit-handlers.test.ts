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

let taskSeq = 0;
function setFetch() {
  calls = [];
  taskSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes("/contacts/records?") && method === "GET") return { ok: true, json: async () => ({ items: existing ? [existing] : [] }) };
    if (method === "GET" && /\/(tasks|followups|leads)\/records\/[^?]+$/.test(url)) {
      return { ok: true, json: async () => ownedRow };
    }
    if (method === "POST") {
      const col = url.match(/\/collections\/([^/]+)\/records/)?.[1] ?? "x";
      if (col === "workflow_tasks") return { ok: true, json: async () => ({ id: `wt-${++taskSeq}` }) };
      if (col === "workflows") return { ok: true, json: async () => ({ id: "wf-1" }) };
      return { ok: true, json: async () => ({ id: idmap[col] ?? "x-1" }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}
let ownedRow: Record<string, unknown> | null = { user: "userA" };
const created = (col: string) => calls.find((c) => c.url.includes(`/collections/${col}/records`) && c.method === "POST");
const enqueued = (sid: string) => calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST" && (c.body as { specialist_id?: string })?.specialist_id === sid);

beforeEach(() => { rec.fn.mockClear(); existing = null; ownedRow = { user: "userA" }; setFetch(); });
afterEach(() => vi.unstubAllGlobals());
const wfTasks = () => calls.filter((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");

describe("COMMIT_HANDLERS", () => {
  it("create_contact writes a contact and ENQUEUES the twenty mirror (no inline call)", async () => {
    const r = await COMMIT_HANDLERS.create_contact!({ name: "Jane", email: "j@x.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "c-1", extra: { twenty_mirror_status: "pending" } });
    expect((created("contacts")!.body as { user: string }).user).toBe("userA");
    expect(enqueued("mirror_retry_worker")).toBeDefined();
    expect(rec.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "user_confirmed_fact" }));
  });

  it("log_interaction writes an interactions row", async () => {
    const r = await COMMIT_HANDLERS.log_interaction!({ contact_name: "Jane", interaction_type: "call", notes: "pricing" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "i-1" });
    expect((created("interactions")!.body as { type: string }).type).toBe("call");
    expect(rec.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "interaction_logged" }));
  });

  it("schedule_followup writes a pending followup", async () => {
    const r = await COMMIT_HANDLERS.schedule_followup!({ contact_name: "Jane", due_date: "2026-07-01" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "f-1" });
    expect((created("followups")!.body as { status: string }).status).toBe("pending");
  });

  it("add_to_email_list creates the contact when new and enqueues listmonk subscribe (on the bus)", async () => {
    const r = await COMMIT_HANDLERS.add_to_email_list!({ email: "new@x.com", name: "New" }, ctx);
    expect(r.ok).toBe(true);
    expect(created("contacts")).toBeDefined();
    expect(enqueued("listmonk_subscribe_worker")).toBeDefined();
    expect((enqueued("listmonk_subscribe_worker")!.body as { input_payload: { email: string } }).input_payload.email).toBe("new@x.com");
  });

  it("add_to_email_list reuses an existing contact (no duplicate create)", async () => {
    existing = { id: "c-9", twenty_record_id: "tw-9" };
    const r = await COMMIT_HANDLERS.add_to_email_list!({ email: "known@x.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "c-9" });
    expect(created("contacts")).toBeUndefined(); // found, not created
    expect(enqueued("listmonk_subscribe_worker")).toBeDefined();
  });

  it("create_task writes a task; missing title → 400", async () => {
    expect(await COMMIT_HANDLERS.create_task!({ title: "Call accountant" }, ctx)).toMatchObject({ ok: true, record_id: "t-1" });
    expect(await COMMIT_HANDLERS.create_task!({ notes: "no title" }, ctx)).toMatchObject({ ok: false, status: 400 });
  });

  it("capture_lead creates a contact + lead and enqueues the twenty mirror", async () => {
    const r = await COMMIT_HANDLERS.capture_lead!({ name: "John", company: "Acme", interest_summary: "consulting" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "l-1", extra: { contact_id: "c-1" } });
    expect(created("leads")).toBeDefined();
    expect(enqueued("mirror_retry_worker")).toBeDefined();
  });

  it("update_contact patches an existing contact and enqueues a twenty UPDATE", async () => {
    existing = { id: "c-7", twenty_record_id: "tw-7" };
    const r = await COMMIT_HANDLERS.update_contact!({ contact_identifier: "Jane", new_email: "jane@new.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "c-7" });
    expect(calls.some((c) => c.url.includes("/contacts/records/c-7") && c.method === "PATCH")).toBe(true);
    const task = enqueued("twenty_update_worker");
    expect((task!.body as { input_payload: { twenty_record_id: string } }).input_payload.twenty_record_id).toBe("tw-7");
  });

  it("update_contact 404s when no contact matches", async () => {
    existing = null;
    expect(await COMMIT_HANDLERS.update_contact!({ contact_identifier: "Ghost", new_email: "x@y.com" }, ctx)).toMatchObject({ ok: false, status: 404 });
  });

  it("log_expense writes a numeric amount and marks billable when a client is named", async () => {
    const r = await COMMIT_HANDLERS.log_expense!({ amount: "$45.50", category: "office", client_name: "Acme" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "e-1" });
    const body = created("expenses")!.body as { amount: number; billable: boolean; currency: string };
    expect(body.amount).toBe(45.5);
    expect(body.billable).toBe(true);
    expect(body.currency).toBe("USD");
  });

  it("log_expense rejects a non-numeric amount", async () => {
    expect(await COMMIT_HANDLERS.log_expense!({ amount: "lots", category: "x" }, ctx)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("delegate handlers (W95.4b)", () => {
  it("draft_campaign creates a 1-task Marketing workflow + completion message", async () => {
    const r = await COMMIT_HANDLERS.draft_campaign!({ message_summary: "Black Friday sale", occasion: "Black Friday" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "wf-1" });
    expect(((r as unknown) as { extra?: { expected_completion_message?: string } }).extra?.expected_completion_message).toMatch(/Marketing/);
    expect(calls.some((c) => c.url.includes("/workflows/records") && c.method === "POST")).toBe(true);
    const tasks = wfTasks();
    expect(tasks).toHaveLength(1);
    expect((tasks[0]!.body as { department_id: string }).department_id).toBe("marketing");
  });

  it("send_for_signature (W95.6.x) creates a review-required workflow with ONLY the legal draft task", async () => {
    const r = await COMMIT_HANDLERS.send_for_signature!({ document_identifier: "consulting agreement", signer_email: "jane@x.com" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "wf-1" });
    const wf = created("workflows")!.body as { review_required: boolean; recipe_id: string };
    expect(wf.review_required).toBe(true);
    expect(wf.recipe_id).toBe("send_for_signature");
    const tasks = wfTasks();
    expect(tasks).toHaveLength(1); // docuseal send is enqueued by /approve, not upfront
    const legal = tasks[0]!.body as { department_id: string; input_payload: { signer_email: string } };
    expect(legal.department_id).toBe("legal");
    expect(legal.input_payload.signer_email).toBe("jane@x.com");
    expect(rec.fn).toHaveBeenCalledWith(expect.objectContaining({ decision_kind: "signature_requested" }));
  });

  it("send_for_signature resolves the signer email from a contact when not explicit", async () => {
    existing = { id: "c-1", email: "found@x.com", twenty_record_id: "" } as never;
    await COMMIT_HANDLERS.send_for_signature!({ document_identifier: "nda", signer_name: "Jane" }, ctx);
    const legal = wfTasks()[0]!.body as { input_payload: { signer_email: string } };
    expect(legal.input_payload.signer_email).toBe("found@x.com");
  });
});

describe("Chatwoot write intents (W95.6.x)", () => {
  it("reply_to_ticket creates a review-required workflow (recipe reply_to_ticket) + reputation draft task", async () => {
    const r = await COMMIT_HANDLERS.reply_to_ticket!({ conversation_identifier: "Acme", message_summary: "we can help", tone: "friendly" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "wf-1" });
    const wf = created("workflows")!.body as { review_required: boolean; recipe_id: string };
    expect(wf).toMatchObject({ review_required: true, recipe_id: "reply_to_ticket" });
    const tasks = wfTasks();
    expect(tasks).toHaveLength(1); // only the draft task; send enqueued on approve
    expect((tasks[0]!.body as { department_id: string }).department_id).toBe("reputation");
  });

  it("resolve_ticket enqueues chatwoot_resolve_worker", async () => {
    await COMMIT_HANDLERS.resolve_ticket!({ conversation_identifier: "Acme" }, ctx);
    expect(enqueued("chatwoot_resolve_worker")).toBeDefined();
  });

  it("tag_conversation enqueues chatwoot_tag_worker with the label; 400 without a label", async () => {
    await COMMIT_HANDLERS.tag_conversation!({ conversation_identifier: "Acme", label: "urgent" }, ctx);
    expect((enqueued("chatwoot_tag_worker")!.body as { input_payload: { label: string } }).input_payload.label).toBe("urgent");
    expect(await COMMIT_HANDLERS.tag_conversation!({ conversation_identifier: "Acme" }, ctx)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("status-update handlers (W95.4b)", () => {
  it("update_task_status flips an owned task to done", async () => {
    ownedRow = { user: "userA", status: "pending" };
    const r = await COMMIT_HANDLERS.update_task_status!({ task_id: "t-9", new_status: "done" }, ctx);
    expect(r).toMatchObject({ ok: true, record_id: "t-9" });
    expect(calls.some((c) => c.url.includes("/tasks/records/t-9") && c.method === "PATCH" && c.body?.status === "done")).toBe(true);
  });

  it("update_followup_status applies a reschedule due date", async () => {
    ownedRow = { user: "userA" };
    await COMMIT_HANDLERS.update_followup_status!({ followup_id: "f-9", new_status: "pending", new_due_date: "2026-08-01" }, ctx);
    const patch = calls.find((c) => c.url.includes("/followups/records/f-9") && c.method === "PATCH");
    expect(patch!.body).toMatchObject({ status: "pending", due_date: "2026-08-01" });
  });

  it("update_lead_status changes status for an owned lead", async () => {
    ownedRow = { user: "userA" };
    const r = await COMMIT_HANDLERS.update_lead_status!({ lead_id: "l-9", new_status: "qualified" }, ctx);
    expect(r).toMatchObject({ ok: true });
  });

  it("404s when the row belongs to another user (defensive ownership check)", async () => {
    ownedRow = { user: "someone_else" };
    expect(await COMMIT_HANDLERS.update_task_status!({ task_id: "t-9", new_status: "done" }, ctx)).toMatchObject({ ok: false, status: 404 });
  });

  it("400s when id or status is missing", async () => {
    expect(await COMMIT_HANDLERS.update_lead_status!({ lead_id: "", new_status: "x" }, ctx)).toMatchObject({ ok: false, status: 400 });
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
