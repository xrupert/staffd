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
import { TwentyClient } from "../integrations/twenty/client";
import { ListmonkClient } from "../integrations/listmonk/client";
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

// ── twenty_mirror_retry (W95.2) — initial/retry mirror of a STAFFD contact ──
const mirrorRetry: WorkerHandler = async (task, ctx) => {
  const p = task.input_payload as { vendor?: string; record_id?: string; fields?: { name?: string; email?: string; phone?: string } };
  if (p.vendor === "twenty" && p.record_id && p.fields?.name) {
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
  const patchDoc = (patch: Record<string, unknown>) =>
    fetch(`${ctx.pb}/api/collections/documents/records/${p.document_id}`, { method: "PATCH", headers: ctx.authHeaders, body: JSON.stringify(patch) });

  const docRes = await fetch(`${ctx.pb}/api/collections/documents/records/${p.document_id}`, { headers: { Authorization: ctx.adminToken } });
  if (!docRes.ok) throw new Error(`extraction: document ${p.document_id} not found (${docRes.status})`);
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
  const fileUrl = `${ctx.pb}/api/files/documents/${p.document_id}/${encodeURIComponent(doc.file)}${fileToken ? `?token=${fileToken}` : ""}`;
  const blobRes = await fetch(fileUrl, { headers: { Authorization: ctx.adminToken } });
  if (!blobRes.ok) throw new Error(`extraction: file fetch failed (${blobRes.status})`);
  const buf = new Uint8Array(await blobRes.arrayBuffer());

  const result = await extractText(buf, kind);
  if (result.ok) {
    await patchDoc({ output: result.text || "[Document uploaded — no readable text found.]", extraction_status: "extracted" });
    return { text: `extracted:${result.text.length}`, tokensActual: 0 };
  }
  if ((task.retry_count ?? 0) >= 2) {
    await patchDoc({ extraction_status: "error", output: "[We couldn't read this file automatically. Your specialist can still work from the file name and your description.]" });
    return { text: "extraction:failed-final", tokensActual: 0 };
  }
  throw new Error(`extraction failed: ${result.reason ?? "unknown"}`);
};

// ── listmonk_subscribe (W95.4a) — add a contact to the customer's list (bus) ──
const listmonkSubscribe: WorkerHandler = async (task) => {
  const p = task.input_payload as { email?: string; name?: string };
  if (!p.email) throw new Error("listmonk subscribe: missing email");
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
  const ok = await TwentyClient.forCustomer(task.user).updatePerson(p.twenty_record_id, p.fields ?? {});
  if (!ok) throw new Error("twenty update failed");
  if (p.record_id) {
    await fetch(`${ctx.pb}/api/collections/contacts/records/${p.record_id}`, {
      method: "PATCH", headers: ctx.authHeaders,
      body: JSON.stringify({ twenty_mirror_status: "synced", last_mirror_attempt: new Date().toISOString() }),
    });
  }
  return { text: `updated:${p.twenty_record_id}`, tokensActual: 0 };
};

export const WORKER_HANDLERS: Record<string, WorkerHandler> = {
  mirror_retry_worker: mirrorRetry,
  document_extraction_worker: documentExtraction,
  listmonk_subscribe_worker: listmonkSubscribe,
  twenty_update_worker: twentyUpdate,
};
