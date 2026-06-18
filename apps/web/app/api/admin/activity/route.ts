/**
 * GET /api/admin/activity (W95.5) — super-admin view of autopilot fires across
 * all users (operator health + intervention). Read-only; capped scan. Each row
 * carries a derived status: undone | expired | active (within undo window).
 * Optional filters: ?user= &intent_type= &status=
 */

import { getAdminToken, pbUrl, pbEscape } from "../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

const CAP = 100;

export async function GET(req: Request) {
  try { await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "PocketBase not configured" }, { status: 503 }); }
  const pb = pbUrl();
  const url = new URL(req.url);
  const fUser = url.searchParams.get("user")?.trim();
  const fIntent = url.searchParams.get("intent_type")?.trim();
  const fStatus = url.searchParams.get("status")?.trim();

  const clauses: string[] = [];
  if (fUser) clauses.push(`user = "${pbEscape(fUser)}"`);
  if (fIntent) clauses.push(`intent_type = "${pbEscape(fIntent)}"`);
  const filter = clauses.length ? `&filter=${encodeURIComponent(clauses.join(" && "))}` : "";

  const res = await fetch(`${pb}/api/collections/autopilot_audit_log/records?perPage=${CAP}&sort=-committed_at${filter}`, { headers: { Authorization: token } });
  if (!res.ok) return Response.json({ items: [] }); // not migrated yet → empty
  const rows = ((await res.json()) as { items?: Record<string, unknown>[] }).items ?? [];
  const now = Date.now();

  let items = rows.map((r) => {
    const undone = !!r.undone_at;
    const expired = !undone && now > new Date(r.undo_window_expires_at as string).getTime();
    return {
      id: r.id, user: r.user, intent_type: r.intent_type, target_collection: r.target_collection,
      target_record_id: r.target_record_id, committed_at: r.committed_at,
      undo_window_expires_at: r.undo_window_expires_at,
      status: undone ? "undone" : expired ? "expired" : "active",
    };
  });
  if (fStatus) items = items.filter((i) => i.status === fStatus);

  return Response.json({ items, generatedAt: new Date().toISOString() });
}
