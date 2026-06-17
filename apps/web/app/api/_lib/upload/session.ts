/**
 * recordUploadSession (W95.3) — write the per-customer upload ledger row
 * (USER_OWNED `upload_sessions`, drives the owner's "recent uploads" list)
 * plus the operator-facing audit row (super_admin_usage_log). Best-effort:
 * a ledger failure never fails the upload itself.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../pb";

export type UploadKind = "contacts" | "documents";

export type UploadStats = {
  fileCount: number;
  rowCount: number;
  succeeded: number;
  failed: number;
  summary: string; // STAFFD-voice one-liner
};

export async function recordUploadSession(userId: string, kind: UploadKind, stats: UploadStats): Promise<void> {
  let token: string;
  try { token = await getAdminToken(); } catch { return; }
  const pb = pbUrl();

  // USER_OWNED ledger row — the owner's own upload history.
  void fetch(`${pb}/api/collections/upload_sessions/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: userId,
      kind,
      file_count: stats.fileCount,
      row_count: stats.rowCount,
      succeeded: stats.succeeded,
      failed: stats.failed,
      summary: stats.summary,
    }),
  }).catch(() => {});

  // Operator-facing audit row.
  void fetch(`${pb}/api/collections/super_admin_usage_log/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: userId,
      operation_type: "upload_session",
      operation_detail: stats.summary,
      parameters: JSON.stringify({ kind, file_count: stats.fileCount, rows: stats.rowCount, succeeded: stats.succeeded, failed: stats.failed }),
    }),
  }).catch(() => {});
}
