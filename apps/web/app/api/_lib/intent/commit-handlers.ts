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
import { setEnabled, recordRevocation } from "../autopilot/policy";
import { routeTask, DEPARTMENT_DEFAULT_AGENT_IDS, type Department } from "@staffd/agents";

/** Audited intents write an autopilot_audit_log row + get an undo toast.
 *  Maps each to its PRIMARY STAFFD-native collection (for undo). */
export const AUDITED_TARGET: Record<string, string> = {
  create_contact: "contacts", capture_lead: "leads", update_contact: "contacts",
  add_to_email_list: "contacts", log_expense: "expenses",
};

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

/** Find this user's contact by email or name. Returns id + email + twenty mirror id. */
async function findContact(ctx: CommitCtx, by: { email?: string; name?: string }): Promise<{ id: string; email: string; twenty_record_id: string } | null> {
  const ors: string[] = [];
  if (by.email) ors.push(`email = "${pbEscape(by.email)}"`);
  if (by.name) ors.push(`name = "${pbEscape(by.name)}"`);
  if (ors.length === 0) return null;
  const filter = encodeURIComponent(`user = "${pbEscape(ctx.userId)}" && (${ors.join(" || ")})`);
  const res = await fetch(`${pbUrl()}/api/collections/contacts/records?filter=${filter}&perPage=1&fields=id,email,twenty_record_id`, { headers: { Authorization: ctx.token } });
  if (!res.ok) return null;
  const row = ((await res.json()) as { items?: { id: string; email?: string; twenty_record_id?: string }[] }).items?.[0];
  return row ? { id: row.id, email: row.email ?? "", twenty_record_id: row.twenty_record_id ?? "" } : null;
}

/** Load a row and confirm it belongs to the requesting user (defensive — row
 *  rules already enforce, but status handlers double-check). */
async function pbGetOwned(collection: string, id: string, ctx: CommitCtx): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${pbUrl()}/api/collections/${collection}/records/${id}`, { headers: { Authorization: ctx.token } });
  if (!res.ok) return null;
  const row = (await res.json()) as Record<string, unknown>;
  return row.user === ctx.userId ? row : null;
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
  let contactWasNew = false;
  if (!contact) {
    const rec = await pbCreate("contacts", { user: ctx.userId, name: f.name ?? email, email, twenty_mirror_status: "pending" }, ctx.token);
    if (!rec.ok) return { ok: false, status: 502, error: "save_failed" };
    contact = { id: rec.id, email, twenty_record_id: "" };
    contactWasNew = true;
    enqueue("mirror_retry_worker", { vendor: "twenty", record_id: rec.id, fields: { name: f.name ?? email, email } }, ctx);
  }
  // Listmonk subscribe — on the bus (Standard #20), no inline vendor call.
  // record_id lets the worker tombstone-check the source contact (W95.5.1).
  enqueue("listmonk_subscribe_worker", { email, name: f.name ?? "", record_id: contact.id }, ctx);
  decide(ctx, "email_list_subscribed", `Added ${email} to the email list`, contact.id);
  // previous_state powers undo: only delete the contact on undo if WE created it.
  return { ok: true, record_id: contact.id, extra: { previous_state: { contact_was_new: contactWasNew, email } } };
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

  // Snapshot prior values of the fields we're about to change → undo restore.
  const before = await pbGetOwned("contacts", found.id, ctx);
  const previous_state: Record<string, string> = {};
  for (const k of Object.keys(updated)) previous_state[k] = (before?.[k] as string) ?? "";

  const ok = await pbPatch("contacts", found.id, { ...updated, twenty_mirror_status: "pending" }, ctx.token);
  if (!ok) return { ok: false, status: 502, error: "save_failed" };
  enqueue("twenty_update_worker", { record_id: found.id, twenty_record_id: found.twenty_record_id, fields: { name: updated.name, email: updated.email, phone: updated.phone } }, ctx);
  decide(ctx, "contact_updated", `Updated contact ${updated.name ?? ident}`, found.id);
  return { ok: true, record_id: found.id, extra: { previous_state, twenty_record_id: found.twenty_record_id } };
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

// ── delegate-to-specialist (W95.4b) — create a workflow + first task(s) on the
// W71/W72 substrate; the specialist does the work, W72 reconcile enriches Vault.
async function createWorkflow(name: string, rootGoal: string, ctx: CommitCtx, opts: { reviewRequired?: boolean; recipeId?: string } = {}): Promise<string> {
  const wf = await pbCreate("workflows", {
    user: ctx.userId, name, status: "pending", root_goal: rootGoal, started_at: nowIso(),
    review_required: !!opts.reviewRequired, recipe_id: opts.recipeId ?? "",
  }, ctx.token);
  return wf.ok ? wf.id : "";
}
async function createTaskRow(wfId: string, specialistId: string, dept: string, payload: Record<string, unknown>, dependsOn: string[], ctx: CommitCtx): Promise<string> {
  const t = await pbCreate("workflow_tasks", {
    workflow_id: wfId, user: ctx.userId, specialist_id: specialistId, department_id: dept,
    input_payload: payload, output_payload: null, status: "pending", depends_on: dependsOn,
    retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0,
  }, ctx.token);
  return t.ok ? t.id : "";
}
function specialistFor(dept: Department, text: string): string {
  try { const m = routeTask(text, dept); if (m?.id) return m.id; } catch { /* fall through */ }
  return DEPARTMENT_DEFAULT_AGENT_IDS[dept];
}

const draftCampaign: CommitHandler = async (f, ctx) => {
  const summary = (f.message_summary ?? "").trim();
  if (!summary) return { ok: false, status: 400, error: "message_summary_required" };
  const wfId = await createWorkflow(`Email campaign — ${f.occasion || summary.slice(0, 40)}`, summary, ctx);
  if (!wfId) return { ok: false, status: 502, error: "workflow_create_failed" };
  const agent = specialistFor("marketing", summary);
  const task = `Draft an email campaign. Goal: ${summary}.${f.occasion ? ` Occasion: ${f.occasion}.` : ""}${f.subject_hint ? ` Subject idea: ${f.subject_hint}.` : ""} Audience: ${f.target_audience || "all subscribers"}.`;
  await createTaskRow(wfId, agent, "marketing", { task, fields: f }, [], ctx);
  return { ok: true, record_id: wfId, extra: { workflow_id: wfId, expected_completion_message: "Marketing is drafting your campaign — I'll let you know when it's ready." } };
};

const sendForSignature: CommitHandler = async (f, ctx) => {
  const docId = (f.document_identifier ?? "").trim();
  if (!docId) return { ok: false, status: 400, error: "document_identifier_required" };
  // Resolve signer email: explicit > contact lookup by name/email.
  let signerEmail = (f.signer_email ?? "").trim();
  if (!signerEmail) {
    const ref = (f.signer_contact ?? f.signer_name ?? "").trim();
    if (ref) { const c = await findContact(ctx, { email: ref, name: ref }); signerEmail = c?.email ?? ""; }
  }
  // W95.6.x — review_required: only the Legal draft task is created now. The
  // Docuseal send is enqueued by the approve endpoint after the owner reviews
  // the contract draft (no auto-send of a customer-facing artifact).
  const wfId = await createWorkflow(`Signature — ${docId.slice(0, 40)}`, `Send "${docId}" for signature`, ctx, { reviewRequired: true, recipeId: "send_for_signature" });
  if (!wfId) return { ok: false, status: 502, error: "workflow_create_failed" };
  await createTaskRow(wfId, specialistFor("legal", `prepare ${docId} for signature`), "legal", { task: `Prepare "${docId}" for signature${f.notes ? ` (${f.notes})` : ""}.`, fields: f, document_identifier: docId, signer_email: signerEmail, signer_name: f.signer_name ?? "" }, [], ctx);
  decide(ctx, "signature_requested", `Requested signature on "${docId}"${signerEmail ? ` from ${signerEmail}` : ""}`, wfId);
  return { ok: true, record_id: wfId, extra: { workflow_id: wfId, expected_completion_message: "Legal is drafting your document — review it before it goes out for signature." } };
};

// ── reply_to_ticket (W95.6.x) — delegate to Reputation WITH review step. ──
const replyToTicket: CommitHandler = async (f, ctx) => {
  const ident = (f.conversation_identifier ?? "").trim();
  const summary = (f.message_summary ?? "").trim();
  if (!ident || !summary) return { ok: false, status: 400, error: "conversation_and_summary_required" };
  const wfId = await createWorkflow("Support reply", summary, ctx, { reviewRequired: true, recipeId: "reply_to_ticket" });
  if (!wfId) return { ok: false, status: 502, error: "workflow_create_failed" };
  await createTaskRow(wfId, specialistFor("reputation", `reply to support ticket: ${summary}`), "reputation",
    { task: `Draft a ${f.tone || "friendly"} reply to this support conversation. Goal: ${summary}.`, conversation_identifier: ident, message_summary: summary, tone: f.tone ?? "" }, [], ctx);
  decide(ctx, "reply_drafted", `Drafting a reply to ${ident}`, wfId);
  return { ok: true, record_id: wfId, extra: { workflow_id: wfId, expected_completion_message: "Reputation is drafting your reply — you'll review it before it sends." } };
};

// ── resolve_ticket / tag_conversation (W95.6.x) — direct status changes; the
// worker resolves the identifier → conversation id (keeps Chatwoot in workers).
const resolveTicket: CommitHandler = async (f, ctx) => {
  const ident = (f.conversation_identifier ?? "").trim();
  if (!ident) return { ok: false, status: 400, error: "conversation_identifier_required" };
  const t = await pbCreate("workflow_tasks", { workflow_id: "", user: ctx.userId, specialist_id: "chatwoot_resolve_worker", department_id: "system", input_payload: { conversation_identifier: ident }, output_payload: null, status: "pending", depends_on: [], retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0 }, ctx.token);
  if (!t.ok) return { ok: false, status: 502, error: "enqueue_failed" };
  decide(ctx, "ticket_resolved", `Resolving ticket from ${ident}`, t.id);
  return { ok: true, record_id: t.id };
};

const tagConversation: CommitHandler = async (f, ctx) => {
  const ident = (f.conversation_identifier ?? "").trim();
  const label = (f.label ?? "").trim();
  if (!ident || !label) return { ok: false, status: 400, error: "conversation_and_label_required" };
  const t = await pbCreate("workflow_tasks", { workflow_id: "", user: ctx.userId, specialist_id: "chatwoot_tag_worker", department_id: "system", input_payload: { conversation_identifier: ident, label }, output_payload: null, status: "pending", depends_on: [], retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0 }, ctx.token);
  if (!t.ok) return { ok: false, status: 502, error: "enqueue_failed" };
  decide(ctx, "ticket_tagged", `Tagging ${ident} as "${label}"`, t.id);
  return { ok: true, record_id: t.id };
};

const delegate = (subtype: string): CommitHandler => (subtype === "draft_campaign" ? draftCampaign : sendForSignature);

// ── status updates (W95.4b) — UI-triggered from list drawers, not extracted.
// STAFFD-native only, no vendor mirror. Ownership double-checked defensively.
function statusHandler(collection: string, idKey: string, kind: string): CommitHandler {
  return async (f, ctx) => {
    const id = (f[idKey] ?? "").trim();
    const status = (f.new_status ?? "").trim();
    if (!id || !status) return { ok: false, status: 400, error: "id_and_status_required" };
    const owned = await pbGetOwned(collection, id, ctx);
    if (!owned) return { ok: false, status: 404, error: "not_found" };
    const patch: Record<string, unknown> = { status };
    if (collection === "followups" && f.new_due_date) patch.due_date = f.new_due_date;
    const ok = await pbPatch(collection, id, patch, ctx.token);
    if (!ok) return { ok: false, status: 502, error: "save_failed" };
    decide(ctx, kind, `${collection.slice(0, -1)} → ${status}`, id);
    return { ok: true, record_id: id };
  };
}

async function pbDelete(collection: string, id: string, token: string): Promise<boolean> {
  const res = await fetch(`${pbUrl()}/api/collections/${collection}/records/${id}`, { method: "DELETE", headers: { Authorization: token } });
  return res.ok;
}

// ── disable_autopilot (W95.5) — meta-control: turn OFF auto-handling. Always a
// modal (policy "never"), so it can't auto-disable itself.
const disableAutopilot: CommitHandler = async (f, ctx) => {
  const target = (f.intent_type ?? "").trim();
  if (!target) return { ok: false, status: 400, error: "intent_type_required" };
  await setEnabled(ctx.userId, target, false, ctx.token);
  decide(ctx, "autopilot_disabled", `Turned off autopilot for ${target}`, target);
  return { ok: true, record_id: target };
};

// ── undo (W95.5) — reverse an autopilot fire within its 10-minute window.
// Reads the autopilot_audit_log row, reverses the STAFFD-native write + any
// vendor mirror (via the bus), resets the streak, and starts the 7-day cooldown.
const undo: CommitHandler = async (f, ctx) => {
  const auditId = (f.audit_row_id ?? "").trim();
  if (!auditId) return { ok: false, status: 400, error: "audit_row_id_required" };
  const a = await pbGetOwned("autopilot_audit_log", auditId, ctx);
  if (!a) return { ok: false, status: 404, error: "not_found" };
  if (a.undone_at) return { ok: false, status: 409, error: "already_undone" };
  if (Date.now() > new Date(a.undo_window_expires_at as string).getTime()) return { ok: false, status: 410, error: "window_expired" };

  const intentType = a.intent_type as string;
  const collection = a.target_collection as string;
  const recordId = a.target_record_id as string;
  const prev = (a.previous_state as Record<string, unknown>) ?? {};

  if (intentType === "update_contact") {
    // Restore prior field values + re-push to the vendor mirror.
    const restore: Record<string, string> = {};
    for (const k of ["name", "email", "phone", "context"]) if (k in prev) restore[k] = String(prev[k] ?? "");
    await pbPatch(collection, recordId, { ...restore, twenty_mirror_status: "pending" }, ctx.token);
    const row = await pbGetOwned(collection, recordId, ctx);
    enqueue("twenty_update_worker", { record_id: recordId, twenty_record_id: (row?.twenty_record_id as string) ?? "", fields: { name: restore.name, email: restore.email, phone: restore.phone } }, ctx);
  } else {
    // Create-type reversal: delete the primary row(s) + reverse vendor mirrors.
    const row = await pbGetOwned(collection, recordId, ctx);
    if (row) {
      if (intentType === "capture_lead") {
        // lead → linked contact carries the Twenty mirror.
        const contactId = (row.contact as string) ?? "";
        if (contactId) {
          const contact = await pbGetOwned("contacts", contactId, ctx);
          if (contact?.twenty_record_id) enqueue("twenty_delete_worker", { twenty_record_id: contact.twenty_record_id }, ctx);
          await pbDelete("contacts", contactId, ctx.token);
        }
        await pbDelete("leads", recordId, ctx.token);
      } else if (intentType === "add_to_email_list") {
        if (row.email) enqueue("listmonk_unsubscribe_worker", { email: row.email }, ctx);
        if (prev.contact_was_new) {
          if (row.twenty_record_id) enqueue("twenty_delete_worker", { twenty_record_id: row.twenty_record_id }, ctx);
          await pbDelete("contacts", recordId, ctx.token);
        }
      } else {
        // create_contact / log_expense
        if (row.twenty_record_id) enqueue("twenty_delete_worker", { twenty_record_id: row.twenty_record_id }, ctx);
        await pbDelete(collection, recordId, ctx.token);
      }
    }
  }

  await pbPatch("autopilot_audit_log", auditId, { undone_at: nowIso() }, ctx.token);
  await recordRevocation(ctx.userId, intentType, ctx.token); // reset streak + disable + 7-day cooldown
  decide(ctx, "autopilot_undone", `Undid auto ${intentType}`, recordId);
  return { ok: true, record_id: recordId, extra: { reverted_record_id: recordId } };
};

export const COMMIT_HANDLERS: Record<string, CommitHandler> = {
  create_contact: createContact,
  log_interaction: logInteraction,
  schedule_followup: scheduleFollowup,
  add_to_email_list: addToEmailList,
  create_task: createTask,
  capture_lead: captureLead,
  update_contact: updateContact,
  log_expense: logExpense,
  // delegate intents → workflow creation
  draft_campaign: delegate("draft_campaign"),
  send_for_signature: delegate("send_for_signature"),
  reply_to_ticket: replyToTicket, // delegate WITH review step (W95.6.x)
  // Chatwoot direct status changes (W95.6.x)
  resolve_ticket: resolveTicket,
  tag_conversation: tagConversation,
  // UI-triggered status updates (list-view drawers)
  update_task_status: statusHandler("tasks", "task_id", "task_status_changed"),
  update_followup_status: statusHandler("followups", "followup_id", "followup_status_changed"),
  update_lead_status: statusHandler("leads", "lead_id", "lead_status_changed"),
  // W95.5 — autopilot meta-controls
  disable_autopilot: disableAutopilot,
  undo,
};
