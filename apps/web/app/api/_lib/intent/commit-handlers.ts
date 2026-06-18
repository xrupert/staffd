/**
 * Intent commit handlers (W95.4a) — one per intent type behind the W95.1
 * confirm-to-commit pattern. Each writes the STAFFD-native row(s) (the source
 * of truth), enqueues any vendor mirror onto the W71 task bus (Standard #20 —
 * NO inline vendor calls), enriches the Vault, and returns a result. The route
 * (/api/intent/commit) just dispatches by type, audits, and Responds.
 *
 * staffdCustomerId = the PB user id everywhere (Model B3).
 */

import { adminHeaders, pbUrl, pbEscape } from "../pb";
import { recordDecision } from "../vault/outcomes";
import type { IntentType } from "../orchestrator/intent";

export type CommitCtx = { token: string; userId: string; source: string };
export type CommitResult =
  | { ok: true; record_id: string; extra?: Record<string, unknown> }
  | { ok: false; status: number; error: string };
export type CommitHandler = (fields: Record<string, string>, ctx: CommitCtx) => Promise<CommitResult>;

// ── shared helpers ──────────────────────────────────────────────────────────

async function pbCreate(collection: string, body: Record<string, unknown>, token: string): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${pbUrl()}/api/collections/${collection}/records`, {
    method: "POST", headers: adminHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, id: "" };
  return { ok: true, id: ((await res.json()) as { id: string }).id };
}

async function pbPatch(collection: string, id: string, body: Record<string, unknown>, token: string): Promise<boolean> {
  const res = await fetch(`${pbUrl()}/api/collections/${collection}/records/${id}`, {
    method: "PATCH", headers: adminHeaders(token), body: JSON.stringify(body),
  });
  return res.ok;
}

function enqueue(specialistId: string, payload: Record<string, unknown>, ctx: CommitCtx): void {
  void fetch(`${pbUrl()}/api/collections/workflow_tasks/records`, {
    method: "POST", headers: adminHeaders(ctx.token),
    body: JSON.stringify({
      workflow_id: "", user: ctx.userId, specialist_id: specialistId, department_id: "system",
      input_payload: payload, output_payload: null, status: "pending", depends_on: [],
      retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0,
    }),
  }).catch(() => {});
}

/** Find this user's contact by email or name. Returns id + twenty mirror id. */
async function findContact(ctx: CommitCtx, by: { email?: string; name?: string }): Promise<{ id: string; twenty_record_id: string } | null> {
  const ors: string[] = [];
  if (by.email) ors.push(`email = "${pbEscape(by.email)}"`);
  if (by.name) ors.push(`name = "${pbEscape(by.name)}"`);
  if (ors.length === 0) return null;
  const filter = encodeURIComponent(`user = "${pbEscape(ctx.userId)}" && (${ors.join(" || ")})`);
  const res = await fetch(`${pbUrl()}/api/collections/contacts/records?filter=${filter}&perPage=1&fields=id,twenty_record_id`, { headers: { Authorization: ctx.token } });
  if (!res.ok) return null;
  const row = ((await res.json()) as { items?: { id: string; twenty_record_id?: string }[] }).items?.[0];
  return row ? { id: row.id, twenty_record_id: row.twenty_record_id ?? "" } : null;
}

function decide(ctx: CommitCtx, kind: string, title: string, sourceId: string): void {
  void recordDecision({ userId: ctx.userId, decision_kind: kind, title, source_kind: "manual", source_id: sourceId });
}

const nowIso = () => new Date().toISOString();

// ── handlers ────────────────────────────────────────────────────────────────

const createContact: CommitHandler = async (f, ctx) => {
  const name = (f.name ?? "").trim();
  if (!name) return { ok: false, status: 400, error: "name_required" };
  const rec = await pbCreate("contacts", { user: ctx.userId, name, email: f.email ?? "", phone: f.phone ?? "", context: f.context ?? "", twenty_mirror_status: "pending" }, ctx.token);
  if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
  enqueue("mirror_retry_worker", { vendor: "twenty", record_id: rec.id, fields: { name, email: f.email ?? "", phone: f.phone ?? "" } }, ctx);
  decide(ctx, "user_confirmed_fact", `Added contact "${name}"`, rec.id);
  return { ok: true, record_id: rec.id, extra: { twenty_mirror_status: "pending" } };
};

const logInteraction: CommitHandler = async (f, ctx) => {
  const contactName = (f.contact_name ?? "").trim();
  if (!contactName) return { ok: false, status: 400, error: "contact_name_required" };
  const found = await findContact(ctx, { name: contactName });
  const notes = found ? (f.notes ?? "") : `[re: ${contactName}] ${f.notes ?? ""}`.trim();
  const rec = await pbCreate("interactions", { user: ctx.userId, contact: found?.id ?? "", type: f.interaction_type ?? "other", notes, occurred_at: f.occurred_at || nowIso() }, ctx.token);
  if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
  decide(ctx, "interaction_logged", `Logged ${f.interaction_type ?? "interaction"} with ${contactName}`, rec.id);
  return { ok: true, record_id: rec.id };
};

const scheduleFollowup: CommitHandler = async (f, ctx) => {
  const contactName = (f.contact_name ?? "").trim();
  if (!contactName) return { ok: false, status: 400, error: "contact_name_required" };
  const found = await findContact(ctx, { name: contactName });
  const notes = found ? (f.notes ?? "") : `[re: ${contactName}] ${f.notes ?? ""}`.trim();
  const rec = await pbCreate("followups", { user: ctx.userId, contact: found?.id ?? "", due_date: f.due_date ?? "", status: "pending", notes }, ctx.token);
  if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
  decide(ctx, "followup_scheduled", `Follow up with ${contactName}${f.due_date ? ` (${f.due_date})` : ""}`, rec.id);
  return { ok: true, record_id: rec.id };
};

const addToEmailList: CommitHandler = async (f, ctx) => {
  const email = (f.email ?? "").trim();
  if (!email) return { ok: false, status: 400, error: "email_required" };
  let contact = await findContact(ctx, { email });
  if (!contact) {
    const rec = await pbCreate("contacts", { user: ctx.userId, name: f.name ?? email, email, twenty_mirror_status: "pending" }, ctx.token);
    if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
    contact = { id: rec.id, twenty_record_id: "" };
    enqueue("mirror_retry_worker", { vendor: "twenty", record_id: rec.id, fields: { name: f.name ?? email, email } }, ctx);
  }
  // Listmonk subscribe — on the bus (Standard #20), no inline vendor call.
  enqueue("listmonk_subscribe_worker", { email, name: f.name ?? "" }, ctx);
  decide(ctx, "email_list_subscribed", `Added ${email} to the email list`, contact.id);
  return { ok: true, record_id: contact.id };
};

const createTask: CommitHandler = async (f, ctx) => {
  const title = (f.title ?? "").trim();
  if (!title) return { ok: false, status: 400, error: "title_required" };
  const rec = await pbCreate("tasks", { user: ctx.userId, title, due_date: f.due_date ?? "", status: "pending", notes: f.notes ?? "" }, ctx.token);
  if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
  decide(ctx, "task_created", `Task: ${title}`, rec.id);
  return { ok: true, record_id: rec.id };
};

const captureLead: CommitHandler = async (f, ctx) => {
  const name = (f.name ?? "").trim();
  if (!name) return { ok: false, status: 400, error: "name_required" };
  const contact = await pbCreate("contacts", { user: ctx.userId, name, email: f.email ?? "", phone: f.phone ?? "", context: f.interest_summary ?? "", twenty_mirror_status: "pending" }, ctx.token);
  if (!contact.ok) return { ok: false, status: 502, error: "save_failed" };
  const lead = await pbCreate("leads", { user: ctx.userId, contact: contact.id, company: f.company ?? "", interest_summary: f.interest_summary ?? "", source: f.source ?? "", status: "new" }, ctx.token);
  if (!lead.ok) return { ok: false, status: 502, error: "save_failed" };
  enqueue("mirror_retry_worker", { vendor: "twenty", record_id: contact.id, fields: { name, email: f.email ?? "", phone: f.phone ?? "" } }, ctx);
  decide(ctx, "lead_captured", `Lead: ${name}${f.company ? ` (${f.company})` : ""}`, lead.id);
  return { ok: true, record_id: lead.id, extra: { contact_id: contact.id } };
};

const updateContact: CommitHandler = async (f, ctx) => {
  const ident = (f.contact_identifier ?? "").trim();
  if (!ident) return { ok: false, status: 400, error: "contact_identifier_required" };
  const found = await findContact(ctx, { email: ident, name: ident });
  if (!found) return { ok: false, status: 404, error: "contact_not_found" };

  const updated: Record<string, string> = {};
  if (f.new_name) updated.name = f.new_name;
  if (f.new_email) updated.email = f.new_email;
  if (f.new_phone) updated.phone = f.new_phone;
  if (f.new_context) updated.context = f.new_context;
  if (Object.keys(updated).length === 0) return { ok: false, status: 400, error: "no_fields_to_update" };

  const ok = await pbPatch("contacts", found.id, { ...updated, twenty_mirror_status: "pending" }, ctx.token);
  if (!ok) return { ok: false, status: 502, error: "save_failed" };
  enqueue("twenty_update_worker", { record_id: found.id, twenty_record_id: found.twenty_record_id, fields: { name: updated.name, email: updated.email, phone: updated.phone } }, ctx);
  decide(ctx, "contact_updated", `Updated contact ${updated.name ?? ident}`, found.id);
  return { ok: true, record_id: found.id };
};

const logExpense: CommitHandler = async (f, ctx) => {
  const amount = Number((f.amount ?? "").replace(/[^0-9.]/g, ""));
  if (!amount || Number.isNaN(amount)) return { ok: false, status: 400, error: "amount_required" };
  const client = (f.client_name ?? "").trim();
  const rec = await pbCreate("expenses", {
    user: ctx.userId, amount, currency: (f.currency ?? "USD").toUpperCase().slice(0, 3),
    category: f.category ?? "", description: f.description ?? "", occurred_at: f.occurred_at || nowIso(),
    client, billable: !!client,
  }, ctx.token);
  if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
  decide(ctx, "expense_logged", `Expense: ${f.currency ?? "USD"} ${amount}${f.category ? ` — ${f.category}` : ""}`, rec.id);
  return { ok: true, record_id: rec.id };
};

export const COMMIT_HANDLERS: Record<IntentType, CommitHandler> = {
  create_contact: createContact,
  log_interaction: logInteraction,
  schedule_followup: scheduleFollowup,
  add_to_email_list: addToEmailList,
  create_task: createTask,
  capture_lead: captureLead,
  update_contact: updateContact,
  log_expense: logExpense,
};
