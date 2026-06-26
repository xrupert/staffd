/**
 * Worker-handler registry (W95.4a).
 *
 * The W71 task bus carries non-agent "system" work — vendor mirrors, document
 * extraction, retries. Each kind is keyed by `specialist_id`. workflow-drain's
 * runAgent looks the handler up here and delegates; W71's retry/exhaustion
 * machinery is unchanged (a handler throw = a failed attempt → retry, max 3).
 *
 * Standard #20 — converge ALL vendor mirrors on the bus: /api/intent/commit and
 * the upload routes only ENQUEUE tasks; the actual vendor calls happen here.
 *
 * Adding a handler = one entry in WORKER_HANDLERS (no workflow-drain edit).
 */

import type { WorkflowTask } from "../workflow";
import { pbEscape } from "../pb";
import { TwentyClient } from "../integrations/twenty/client";
import { ListmonkClient } from "../integrations/listmonk/client";
import { DocusealClient } from "../integrations/docuseal/client";
import { ChatwootClient } from "../integrations/chatwoot/client";
import { extractKindFor, extractText } from "../upload/extract";

export type HandlerResult = { text: string; tokensActual: number };

export type WorkerContext = {
  pb: string;
  adminToken: string;
  authHeaders: Record<string, string>;
};

export type WorkerHandler = (task: WorkflowTask, ctx: WorkerContext) => Promise<HandlerResult>;

/** Is this task system/bus work (vs a normal agent task)? */
export function isWorkerTask(specialistId: string | null | undefined): boolean {
  return !!specialistId && specialistId in WORKER_HANDLERS;
}

/**
 * W95.5.1 — undo-mirror race guard. The STAFFD-native row is the source of
 * truth: a CREATE-type vendor mirror must NOT proceed if the row the user is
 * mirroring has been deleted (undo deletes it) or has an undone autopilot
 * fire. Returns the tombstone reason, or null to proceed.
 */
/** W95.6.x — the parent workflow's reviewed draft + whether it was cancelled. */
async function workflowDraft(ctx: WorkerContext, workflowId: string): Promise<{ draft: string; cancelled: boolean }> {
  if (!workflowId) return { draft: "", cancelled: false };
  const r = await fetch(`${ctx.pb}/api/collections/workflows/records/${workflowId}`, { headers: { Authorization: ctx.adminToken } });
  if (!r.ok) return { draft: "", cancelled: true }; // gone → treat as cancelled (tombstone)
  const w = (await r.json()) as { status?: string; draft_output?: string };
  return { draft: w.draft_output ?? "", cancelled: w.status === "cancelled" };
}

async function tombstoneReason(ctx: WorkerContext, collection: string, recordId: string): Promise<"deleted" | "undone" | null> {
  const r = await fetch(`${ctx.pb}/api/collections/${collection}/records/${recordId}`, { headers: { Authorization: ctx.adminToken } });
  if (r.status === 404) return "deleted";
  const f = encodeURIComponent(`target_record_id = "${pbEscape(recordId)}" && undone_at != ""`);
  const a = await fetch(`${ctx.pb}/api/collections/autopilot_audit_log/records?filter=${f}&perPage=1&fields=id`, { headers: { Authorization: ctx.adminToken } });
  if (a.ok && (((await a.json()) as { items?: unknown[] }).items?.length ?? 0) > 0) return "undone";
  return null;
}

// ── twenty_mirror_retry (W95.2) — initial/retry mirror of a STAFFD contact ──
const mirrorRetry: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { vendor?: string; record_id?: string; fields?: { name?: string; email?: string; phone?: string } };
  if (p.vendor === "twenty" && p.record_id && p.fields?.name) {
    // Race guard: don't mirror a contact the user already deleted/undid.
    const ts = await tombstoneReason(ctx, "contacts", p.record_id);
    if (ts) { console.log(`mirror_retry tombstoned-${ts} record=${p.record_id}`); return { text: `tombstoned-${ts}`, tokensActual: 0 }; }
    const twentyId = await TwentyClient.forCustomer(task.user).createPerson({ name: p.fields.name, email: p.fields.email, phone: p.fields.phone });
    if (!twentyId) throw new Error("twenty mirror retry failed");
    await fetch(`${ctx.pb}/api/collections/contacts/records/${p.record_id}`, {
      method: "PATCH", headers: ctx.authHeaders,
      body: JSON.stringify({ twenty_record_id: twentyId, twenty_mirror_status: "synced", last_mirror_attempt: new Date().toISOString() }),
    });
    return { text: `mirrored:${twentyId}`, tokensActual: 0 };
  }
  throw new Error("unsupported mirror-retry payload");
};

// ── document_extraction (W95.3.5) — parse an uploaded file into documents.output ──
const documentExtraction: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { document_id?: string; ext?: string };
  if (!p.document_id) throw new Error("extraction: missing document_id");
  const docId = p.document_id;
  const patchDoc = (patch: Record<string, unknown>) =>
    fetch(`${ctx.pb}/api/collections/documents/records/${docId}`, { method: "PATCH", headers: ctx.authHeaders, body: JSON.stringify(patch) });
  const isFinal = (task.retry_count ?? 0) >= 2;

  // B3 fix — EVERY failure path (doc-fetch, file-token, file-fetch, parse) flows
  // through one catch. Previously only a parser failure recorded a terminal error
  // state; a throw at the doc-fetch or file-fetch step left the document stuck at
  // "pending" FOREVER (the production "never finishes" bug). Now any final-attempt
  // failure marks the document "error" (never stuck), and the exact failing step
  // is logged for observability.
  try {
    const docRes = await fetch(`${ctx.pb}/api/collections/documents/records/${docId}`, { headers: { Authorization: ctx.adminToken } });
    if (!docRes.ok) throw new Error(`document fetch failed (${docRes.status})`);
    const doc = (await docRes.json()) as { id: string; file?: string };
    const kind = extractKindFor(p.ext ?? (doc.file?.split(".").pop() ?? ""));
    if (!kind || !doc.file) {
      await patchDoc({ extraction_status: "error", output: "[No extractable text for this file type.]" });
      return { text: "extraction:skipped", tokensActual: 0 };
    }

    let fileToken = "";
    try {
      const tk = await fetch(`${ctx.pb}/api/files/token`, { method: "POST", headers: ctx.authHeaders });
      if (tk.ok) fileToken = ((await tk.json()) as { token?: string }).token ?? "";
    } catch { /* try without token */ }
    const fileUrl = `${ctx.pb}/api/files/documents/${docId}/${encodeURIComponent(doc.file)}${fileToken ? `?token=${fileToken}` : ""}`;
    const blobRes = await fetch(fileUrl, { headers: { Authorization: ctx.adminToken } });
    if (!blobRes.ok) throw new Error(`file fetch failed (${blobRes.status})`);
    const buf = new Uint8Array(await blobRes.arrayBuffer());

    const result = await extractText(buf, kind);
    if (!result.ok) throw new Error(`parse failed: ${result.reason ?? "unknown"}`);
    await patchDoc({ output: result.text || "[Document uploaded — no readable text found.]", extraction_status: "extracted" });
    return { text: `extracted:${result.text.length}`, tokensActual: 0 };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    // Observability — the exact failing step lands in the Vercel function logs.
    console.error(`[document_extraction] doc=${docId} retry=${task.retry_count ?? 0} final=${isFinal} failed: ${reason}`);
    if (isFinal) {
      await patchDoc({ extraction_status: "error", output: "[We couldn't read this file automatically. Your specialist can still work from the file name and your description.]" });
      return { text: `extraction:failed-final:${reason}`, tokensActual: 0 };
    }
    throw err; // non-final → let W71 retry
  }
};

// ── listmonk_subscribe (W95.4a) — add a contact to the customer's list (bus) ──
const listmonkSubscribe: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { email?: string; name?: string; record_id?: string };
  if (!p.email) throw new Error("listmonk subscribe: missing email");
  // Race guard: skip if the contact this subscribe came from was deleted/undone.
  if (p.record_id) {
    const ts = await tombstoneReason(ctx, "contacts", p.record_id);
    if (ts) { console.log(`listmonk_subscribe tombstoned-${ts} record=${p.record_id}`); return { text: `tombstoned-${ts}`, tokensActual: 0 }; }
  }
  if (!ListmonkClient.configured) throw new Error("listmonk not configured");
  const ok = await ListmonkClient.forCustomer(task.user).addSubscriber({ email: p.email, name: p.name });
  if (!ok) throw new Error("listmonk subscribe failed");
  return { text: `subscribed:${p.email}`, tokensActual: 0 };
};

// ── twenty_update (W95.4a) — push a contact edit to the operator-shared CRM ──
const twentyUpdate: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { record_id?: string; twenty_record_id?: string; fields?: { name?: string; email?: string; phone?: string } };
  if (!p.twenty_record_id) {
    // No mirror exists yet — nothing to update (the contact was never mirrored).
    return { text: "twenty update: no mirror to update", tokensActual: 0 };
  }
  // W95.5.1 — push the CURRENT row state, not the (possibly stale/undone) task
  // payload: if an undo restored the prior values, the row holds the truth.
  let fields = p.fields ?? {};
  if (p.record_id) {
    const r = await fetch(`${ctx.pb}/api/collections/contacts/records/${p.record_id}`, { headers: { Authorization: ctx.adminToken } });
    if (r.status === 404) { console.log(`twenty_update tombstoned-deleted record=${p.record_id}`); return { text: "tombstoned-deleted", tokensActual: 0 }; }
    if (r.ok) { const row = (await r.json()) as { name?: string; email?: string; phone?: string }; fields = { name: row.name, email: row.email, phone: row.phone }; }
  }
  const ok = await TwentyClient.forCustomer(task.user).updatePerson(p.twenty_record_id, fields);
  if (!ok) throw new Error("twenty update failed");
  if (p.record_id) {
    await fetch(`${ctx.pb}/api/collections/contacts/records/${p.record_id}`, {
      method: "PATCH", headers: ctx.authHeaders,
      body: JSON.stringify({ twenty_mirror_status: "synced", last_mirror_attempt: new Date().toISOString() }),
    });
  }
  return { text: `updated:${p.twenty_record_id}`, tokensActual: 0 };
};

// ── docuseal_send (W95.4b) — send a document for signature via the operator-
// shared Docuseal, tenant-tagged. Chained after the Legal task (depends_on).
const docusealSend: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { document_identifier?: string; document_id?: string; signer_email?: string; signer_name?: string };
  if (!p.signer_email) throw new Error("docuseal: missing signer email");
  // W95.6.x — only send the REVIEWED draft. If the workflow was cancelled at
  // the review step, exit cleanly (tombstone). (draft_output is the reviewed
  // contract text; V1 still sends via DOCUSEAL_TEMPLATE_ID — see W95.4b note.)
  if (task.workflow_id) {
    const { cancelled } = await workflowDraft(ctx, task.workflow_id);
    if (cancelled) { console.log(`docuseal_send tombstoned-cancelled wf=${task.workflow_id}`); return { text: "tombstoned-cancelled", tokensActual: 0 }; }
  }
  const templateId = Number(process.env.DOCUSEAL_TEMPLATE_ID ?? "");
  if (!templateId || Number.isNaN(templateId)) throw new Error("docuseal: DOCUSEAL_TEMPLATE_ID not configured");

  // Resolve the document row (to stash the submission id back on it).
  let docId = "";
  if (p.document_id) {
    const r = await fetch(`${ctx.pb}/api/collections/documents/records/${p.document_id}`, { headers: { Authorization: ctx.adminToken } });
    if (r.ok) docId = ((await r.json()) as { id: string }).id;
  } else if (p.document_identifier) {
    const f = encodeURIComponent(`user = "${pbEscape(task.user)}" && prompt ~ "${pbEscape(p.document_identifier)}"`);
    const r = await fetch(`${ctx.pb}/api/collections/documents/records?filter=${f}&perPage=1&fields=id`, { headers: { Authorization: ctx.adminToken } });
    if (r.ok) docId = (((await r.json()) as { items?: { id: string }[] }).items?.[0])?.id ?? "";
  }

  const sub = await DocusealClient.forCustomer(task.user).createSubmission({
    templateId, name: p.document_identifier ?? "Document", signerEmail: p.signer_email, signerName: p.signer_name,
  });
  if (!sub) throw new Error("docuseal submission failed");
  if (docId) {
    await fetch(`${ctx.pb}/api/collections/documents/records/${docId}`, {
      method: "PATCH", headers: ctx.authHeaders, body: JSON.stringify({ docuseal_submission_id: String(sub.id) }),
    });
  }
  return { text: `signature-sent:${sub.id}`, tokensActual: 0 };
};

// ── undo reversal handlers (W95.5) — undo a vendor mirror created by autopilot.
const twentyDelete: WorkerHandler = async (task) => {
  const p = task.input_payload as { twenty_record_id?: string };
  if (!p.twenty_record_id) return { text: "twenty delete: nothing to delete", tokensActual: 0 };
  const ok = await TwentyClient.forCustomer(task.user).deletePerson(p.twenty_record_id);
  if (!ok) throw new Error("twenty delete failed");
  return { text: `deleted:${p.twenty_record_id}`, tokensActual: 0 };
};

const listmonkUnsubscribe: WorkerHandler = async (task) => {
  const p = task.input_payload as { email?: string };
  if (!p.email) return { text: "listmonk unsubscribe: no email", tokensActual: 0 };
  if (!ListmonkClient.configured) throw new Error("listmonk not configured");
  const ok = await ListmonkClient.forCustomer(task.user).removeSubscriber(p.email);
  if (!ok) throw new Error("listmonk unsubscribe failed");
  return { text: `unsubscribed:${p.email}`, tokensActual: 0 };
};

// send_for_signature is `never` policy, so autopilot can't fire it and undo
// never reaches here in V1. Stub keeps the reversal pattern in place.
const docusealVoid: WorkerHandler = async () => {
  throw new Error("docuseal_void_worker not yet implemented (send_for_signature is never-autopilot)");
};

// ── Chatwoot writes (W95.6.x). resolve/tag are direct; send reads the reviewed
// draft from the parent workflow. All resolve the identifier via the leak-guard.
const chatwootResolve: WorkerHandler = async (task) => {
  const p = task.input_payload as { conversation_identifier?: string };
  if (!ChatwootClient.configured) throw new Error("chatwoot not configured");
  const client = ChatwootClient.forCustomer(task.user);
  const id = await client.resolveConversationId(p.conversation_identifier ?? "");
  if (!id) return { text: "chatwoot resolve: conversation not found", tokensActual: 0 };
  if (!(await client.resolveConversation(id))) throw new Error("chatwoot resolve failed");
  return { text: `resolved:${id}`, tokensActual: 0 };
};

const chatwootTag: WorkerHandler = async (task) => {
  const p = task.input_payload as { conversation_identifier?: string; label?: string };
  if (!p.label) throw new Error("chatwoot tag: missing label");
  if (!ChatwootClient.configured) throw new Error("chatwoot not configured");
  const client = ChatwootClient.forCustomer(task.user);
  const id = await client.resolveConversationId(p.conversation_identifier ?? "");
  if (!id) return { text: "chatwoot tag: conversation not found", tokensActual: 0 };
  if (!(await client.addLabel(id, p.label))) throw new Error("chatwoot tag failed");
  return { text: `tagged:${id}`, tokensActual: 0 };
};

const chatwootSend: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { conversation_identifier?: string };
  // Send the REVIEWED draft from the parent workflow; skip if cancelled.
  const { draft, cancelled } = await workflowDraft(ctx, task.workflow_id ?? "");
  if (cancelled) { console.log(`chatwoot_send tombstoned-cancelled wf=${task.workflow_id}`); return { text: "tombstoned-cancelled", tokensActual: 0 }; }
  if (!draft) throw new Error("chatwoot send: no approved draft");
  if (!ChatwootClient.configured) throw new Error("chatwoot not configured");
  const client = ChatwootClient.forCustomer(task.user);
  const id = await client.resolveConversationId(p.conversation_identifier ?? "");
  if (!id) throw new Error("chatwoot send: conversation not found");
  if (!(await client.sendMessage(id, draft))) throw new Error("chatwoot send failed");
  return { text: `replied:${id}`, tokensActual: 0 };
};

export const WORKER_HANDLERS: Record<string, WorkerHandler> = {
  mirror_retry_worker: mirrorRetry,
  document_extraction_worker: documentExtraction,
  listmonk_subscribe_worker: listmonkSubscribe,
  twenty_update_worker: twentyUpdate,
  docuseal_send_worker: docusealSend,
  twenty_delete_worker: twentyDelete,
  listmonk_unsubscribe_worker: listmonkUnsubscribe,
  docuseal_void_worker: docusealVoid,
  chatwoot_resolve_worker: chatwootResolve,
  chatwoot_tag_worker: chatwootTag,
  chatwoot_send_worker: chatwootSend,
};
