/**
 * POST /api/upload/documents/finalize — the post-storage half of document
 * upload (direct-to-PocketBase upload fix). The browser already created the
 * document record (with file) directly against PocketBase, bypassing the
 * Vercel function for the file bytes — this is the ONLY thing that still
 * runs server-side: determine TEXT vs BINARY, decode TEXT inline (reusing
 * the same extractKindFor/extractText the async worker uses for binaries),
 * enqueue the EXISTING document_extraction_worker task for binaries
 * unchanged, and record the Vault decision + upload-session summary
 * (admin-token-mediated — the client never writes these directly).
 *
 * Body: { documentIds: string[] }. Tiny JSON — never size-constrained,
 * regardless of how large the original file was.
 */

import { getAdminToken, pbUrl, adminHeaders } from "../../../_lib/pb";
import { whoAmI } from "../../../_lib/integrations/identity";
import { recordDecision } from "../../../_lib/vault/outcomes";
import { recordUploadSession } from "../../../_lib/upload/session";
import { extractKindFor, extractText } from "../../../_lib/upload/extract";

type DocRow = { id: string; user: string; file: string; extraction_status?: string };
type ResultRow = { document_id: string; name: string; status: "extracted" | "extraction_pending" };
type ErrorRow = { document_id: string; reason: string };

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { documentIds?: string[] };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const ids = (body.documentIds ?? []).filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) return Response.json({ error: "no_document_ids" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const results: ResultRow[] = [];
  const errors: ErrorRow[] = [];

  for (const id of ids) {
    const docRes = await fetch(`${pb}/api/collections/documents/records/${id}`, { headers: { Authorization: token } });
    if (!docRes.ok) { errors.push({ document_id: id, reason: "not_found" }); continue; }
    const doc = (await docRes.json()) as DocRow;
    if (doc.user !== me.id) { errors.push({ document_id: id, reason: "not_owned" }); continue; }

    const ext = (doc.file?.split(".").pop() ?? "").toLowerCase();
    const kind = extractKindFor(ext);
    if (!kind) {
      await fetch(`${pb}/api/collections/documents/records/${id}`, {
        method: "PATCH", headers: adminHeaders(token),
        body: JSON.stringify({ extraction_status: "error", output: "[No extractable text for this file type.]" }),
      });
      errors.push({ document_id: id, reason: "unsupported_type" });
      void recordDecision({ userId: me.id, decision_kind: "document_uploaded", title: `Uploaded "${doc.file}"`, source_kind: "manual", source_id: id, document_id: id });
      continue;
    }

    if (kind === "text") {
      let fileToken = "";
      try {
        const tk = await fetch(`${pb}/api/files/token`, { method: "POST", headers: adminHeaders(token) });
        if (tk.ok) fileToken = ((await tk.json()) as { token?: string }).token ?? "";
      } catch { /* try without token */ }
      const fileUrl = `${pb}/api/files/documents/${id}/${encodeURIComponent(doc.file)}${fileToken ? `?token=${fileToken}` : ""}`;
      const blobRes = await fetch(fileUrl, { headers: { Authorization: token } });
      if (blobRes.ok) {
        const buf = new Uint8Array(await blobRes.arrayBuffer());
        const extracted = await extractText(buf, "text");
        await fetch(`${pb}/api/collections/documents/records/${id}`, {
          method: "PATCH", headers: adminHeaders(token),
          body: JSON.stringify({ output: extracted.text || "[Document uploaded — no readable text found.]", extraction_status: "extracted" }),
        });
        results.push({ document_id: id, name: doc.file, status: "extracted" });
      } else {
        errors.push({ document_id: id, reason: "file_fetch_failed" });
      }
    } else {
      // PDF/DOCX — unchanged async path: enqueue the existing worker task.
      void fetch(`${pb}/api/collections/workflow_tasks/records`, {
        method: "POST", headers: adminHeaders(token),
        body: JSON.stringify({
          workflow_id: "", user: me.id, specialist_id: "document_extraction_worker", department_id: "system",
          input_payload: { document_id: id, ext }, output_payload: null, status: "pending", depends_on: [],
          retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0,
        }),
      }).catch(() => {});
      results.push({ document_id: id, name: doc.file, status: "extraction_pending" });
    }

    void recordDecision({ userId: me.id, decision_kind: "document_uploaded", title: `Uploaded "${doc.file}"`, source_kind: "manual", source_id: id, document_id: id });
  }

  const total = ids.length;
  const succeeded = results.length;
  const failed = errors.length;
  void recordUploadSession(me.id, "documents", {
    fileCount: total, rowCount: total, succeeded, failed,
    summary: `Uploaded ${succeeded} document${succeeded === 1 ? "" : "s"}${failed ? `, ${failed} skipped` : ""}`,
  });

  return Response.json({ ok: true, total, succeeded, failed, results, errors }, { status: 200 });
}
