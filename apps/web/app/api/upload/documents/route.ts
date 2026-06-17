/**
 * POST /api/upload/documents — cold-start document import (W95.3 / W95.3.5).
 *
 * multipart/form-data, one or more `file` entries. Allowed: PDF, DOCX, TXT, MD.
 * Each file → a row in the EXISTING `documents` collection (Standard #20) with
 * the binary stored in `documents.file`, source="upload", and a Vault decision.
 *
 * Extraction (W95.3.5):
 *  • TXT/MD — decoded inline (instant) → output set, extraction_status="extracted".
 *  • PDF/DOCX — stored with extraction_status="pending"; an async
 *    document_extraction_worker task (W71 bus) parses the text into output.
 *
 * Requires the documents-v2 migration (file/source/extraction_status fields).
 * Returns 202 when any file is still extracting so the UI can poll
 * GET /api/documents/<id>.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { recordDecision } from "../../_lib/vault/outcomes";
import { recordUploadSession } from "../../_lib/upload/session";

const MAX_DOC_BYTES = 25 * 1024 * 1024;       // 25 MB / file
const MAX_SESSION_BYTES = 100 * 1024 * 1024;  // 100 MB / session
const TEXT_EXT = new Set(["txt", "md"]);
const BINARY_EXT = new Set(["pdf", "docx"]);

type RowError = { row: number; reason: string };
type DocResult = { document_id: string; name: string; status: "extracted" | "extraction_pending" };

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "invalid_form" }, { status: 400 }); }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "no_file" }, { status: 400 });

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  if (totalBytes > MAX_SESSION_BYTES) return Response.json({ error: "session_too_large", limitBytes: MAX_SESSION_BYTES }, { status: 413 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const errors: RowError[] = [];
  const documents: DocResult[] = [];
  let pendingAny = false;
  let idx = 0;
  for (const file of files) {
    idx++;
    const e = ext(file.name);
    if (!TEXT_EXT.has(e) && !BINARY_EXT.has(e)) {
      errors.push({ row: idx, reason: `unsupported type ".${e}" (allowed: PDF, DOCX, TXT, MD)` });
      continue;
    }
    if (file.size > MAX_DOC_BYTES) {
      errors.push({ row: idx, reason: `file too large (>${MAX_DOC_BYTES} bytes)` });
      continue;
    }

    const isText = TEXT_EXT.has(e);
    const status: DocResult["status"] = isText ? "extracted" : "extraction_pending";
    const output = isText ? await file.text() : "[Reading this document… your specialist will have it shortly.]";

    // Multipart create so the binary lands in documents.file. NOTE: no JSON
    // Content-Type header — fetch sets the multipart boundary itself.
    const fd = new FormData();
    fd.append("user", me.id);
    fd.append("client", "");
    fd.append("department", "library");
    fd.append("agent_name", "Uploaded document");
    fd.append("prompt", file.name);
    fd.append("source", "upload");
    fd.append("extraction_status", isText ? "extracted" : "pending");
    fd.append("output", output);
    fd.append("file", file, file.name);

    const createRes = await fetch(`${pb}/api/collections/documents/records`, {
      method: "POST",
      headers: { Authorization: token },
      body: fd,
    });
    if (!createRes.ok) {
      errors.push({ row: idx, reason: `save_failed (${createRes.status})` });
      continue;
    }
    const record = (await createRes.json()) as { id: string };
    documents.push({ document_id: record.id, name: file.name, status });

    // PDF/DOCX → enqueue async extraction (W71 task bus, drained by workflow-drain).
    if (!isText) {
      pendingAny = true;
      void fetch(`${pb}/api/collections/workflow_tasks/records`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: "",
          user: me.id,
          specialist_id: "document_extraction_worker",
          department_id: "system",
          input_payload: { document_id: record.id, ext: e },
          output_payload: null,
          status: "pending",
          depends_on: [],
          retry_count: 0,
          error: "",
          started_at: "",
          completed_at: "",
          cost_estimate_tokens: 0,
          cost_actual_tokens: 0,
        }),
      }).catch(() => {});
    }

    // Vault enrichment — the staff now know this document exists. source=upload.
    void recordDecision({
      userId: me.id,
      decision_kind: "document_uploaded",
      title: `Uploaded "${file.name}"`,
      source_kind: "manual",
      source_id: record.id,
      document_id: record.id,
    });
  }

  const total = files.length;
  const succeeded = documents.length;
  const failed = total - succeeded;
  const summary = `Uploaded ${succeeded} document${succeeded === 1 ? "" : "s"}${failed ? `, ${failed} skipped` : ""}`;
  void recordUploadSession(me.id, "documents", { fileCount: total, rowCount: total, succeeded, failed, summary });

  return Response.json({ ok: true, total, succeeded, failed, documents, errors }, { status: pendingAny ? 202 : 200 });
}
