/**
 * POST /api/upload/documents — cold-start document import (W95.3).
 *
 * multipart/form-data, one or more `file` entries. Allowed: PDF, DOCX, TXT, MD.
 * Each file → a row in the EXISTING `documents` collection (Standard #20 —
 * reuse, no new collection) + a Vault decision so the staff know it exists.
 *
 * V1 constraints (documented for SA):
 *  • `documents` has no `file` field — binaries are not stored. TXT/MD text is
 *    captured in `output`; PDF/DOCX store a metadata note (text extraction is a
 *    later tranche — no heavy binary-parsing deps in serverless, per the
 *    node:fs deploy footgun).
 *  • `documents` has no `source` field — uploads are marked via
 *    agent_name="Uploaded document" + department="library"; the explicit
 *    source="upload" lives on the Vault decision + the upload_sessions audit.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { recordDecision } from "../../_lib/vault/outcomes";
import { recordUploadSession } from "../../_lib/upload/session";

const MAX_DOC_BYTES = 25 * 1024 * 1024;       // 25 MB / file
const MAX_SESSION_BYTES = 100 * 1024 * 1024;  // 100 MB / session
const TEXT_EXT = new Set(["txt", "md"]);
const BINARY_EXT = new Set(["pdf", "docx"]);

type RowError = { row: number; reason: string };

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
  let succeeded = 0;
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

    const output = TEXT_EXT.has(e)
      ? await file.text()
      : `[Uploaded document: ${file.name} — ${Math.round(file.size / 1024)} KB. Stored as a reference; text extraction is not yet available.]`;

    const createRes = await fetch(`${pb}/api/collections/documents/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: me.id,
        client: "",
        department: "library",
        agent_name: "Uploaded document", // source marker (documents has no `source` field)
        prompt: file.name,
        output,
      }),
    });
    if (!createRes.ok) {
      errors.push({ row: idx, reason: `save_failed (${createRes.status})` });
      continue;
    }
    succeeded++;
    const record = (await createRes.json()) as { id: string };

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
  const failed = total - succeeded;
  const summary = `Uploaded ${succeeded} document${succeeded === 1 ? "" : "s"}${failed ? `, ${failed} skipped` : ""}`;
  void recordUploadSession(me.id, "documents", { fileCount: total, rowCount: total, succeeded, failed, summary });

  return Response.json({ ok: true, total, succeeded, failed, errors });
}
