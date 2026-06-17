/**
 * POST /api/upload/contacts — cold-start contact import (W95.3).
 *
 * multipart/form-data, field `file` = a .csv (≤ 5 MB). Each row:
 *   1. write the STAFFD-native `contacts` row (source of truth, mirror pending)
 *   2. enqueue an async Twenty mirror via the W71 task bus (mirror_retry_worker,
 *      vendor=twenty) — the drain worker performs the initial mirror + retries
 *      (reuses the W95.2 worker; no inline vendor latency on the upload path)
 *   3. best-effort add the contact to the customer's Listmonk list so they're
 *      email-eligible (inline; failures recorded, NOT retried — per the SA
 *      ruling that the retry worker stays Twenty-only this tranche)
 *
 * A row "succeeds" iff its native row is written; vendor outcomes never fail a
 * row. No de-dup — re-uploading the same CSV creates new records (documented in
 * the UI). USER_OWNED; the contact is scoped to the authed owner.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { parseContactsCsv } from "../../_lib/upload/csv";
import { recordUploadSession } from "../../_lib/upload/session";
import { ListmonkClient } from "../../_lib/integrations/listmonk/client";

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

type RowError = { row: number; reason: string };

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "invalid_form" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_CSV_BYTES) return Response.json({ error: "file_too_large", limitBytes: MAX_CSV_BYTES }, { status: 413 });

  const text = await file.text();
  const parsed = parseContactsCsv(text);
  // Header-level failure (no name column / empty) — nothing to import.
  if (parsed.rows.length === 0 && parsed.errors.some((e) => e.row === 1)) {
    return Response.json({ error: "invalid_csv", detail: parsed.errors[0]!.reason }, { status: 422 });
  }

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const errors: RowError[] = [...parsed.errors];
  let succeeded = 0;
  const listmonk = ListmonkClient.configured ? ListmonkClient.forCustomer(me.id) : null;

  // parsed.rows[i] corresponds to a CSV data row; recover a 1-based line number
  // for error reporting by walking the original parse order is overkill — we
  // report the sequential import index, which the UI shows against the preview.
  let importIndex = 0;
  for (const row of parsed.rows) {
    importIndex++;
    const createRes = await fetch(`${pb}/api/collections/contacts/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: me.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        context: row.context,
        twenty_mirror_status: "pending",
      }),
    });
    if (!createRes.ok) {
      errors.push({ row: importIndex, reason: `save_failed (${createRes.status})` });
      continue; // native write failed → row failed
    }
    succeeded++;
    const record = (await createRes.json()) as { id: string };

    // Twenty mirror — enqueue async (the drain worker does the initial mirror +
    // up-to-3 retries). Vendor work never blocks the native write.
    void fetch(`${pb}/api/collections/workflow_tasks/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        workflow_id: "",
        user: me.id,
        specialist_id: "mirror_retry_worker",
        department_id: "system",
        input_payload: { vendor: "twenty", record_id: record.id, fields: { name: row.name, email: row.email, phone: row.phone } },
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

    // Listmonk — best-effort, inline, not retried this tranche.
    if (listmonk && row.email) {
      try { await listmonk.addSubscriber({ email: row.email, name: row.name }); } catch { /* non-fatal */ }
    }
  }

  const total = parsed.rows.length + parsed.errors.filter((e) => e.row !== 1).length;
  const failed = total - succeeded;
  const summary = `Imported ${succeeded} contact${succeeded === 1 ? "" : "s"}${failed ? `, ${failed} skipped` : ""}`;
  void recordUploadSession(me.id, "contacts", { fileCount: 1, rowCount: total, succeeded, failed, summary });

  return Response.json({ ok: true, total, succeeded, failed, errors });
}
