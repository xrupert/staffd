/**
 * GET /api/front-desk/<list> (W95.4b) — top-10 rows for a Front Desk list view
 * (tasks | followups | leads). USER-scoped (admin token + user filter). Server
 * returns CANONICAL order (no client sort/filter UI — Standard #27 scope guard):
 *   - tasks:     pending before done, then due_date asc (overdue first), nulls last
 *   - followups: pending before done, then due_date asc (overdue first), nulls last
 *   - leads:     created desc
 */

import { getAdminToken, pbUrl, pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

const FIELDS: Record<string, string> = {
  tasks: "id,title,due_date,status,notes,created",
  followups: "id,contact,due_date,status,notes,created",
  leads: "id,contact,company,interest_summary,source,status,created",
};

type Row = { id: string; status?: string; due_date?: string; created?: string };

function rankByDue(a: Row, b: Row): number {
  const pa = a.status === "done" ? 1 : 0, pb_ = b.status === "done" ? 1 : 0;
  if (pa !== pb_) return pa - pb_;                       // pending before done
  const da = (a.due_date ?? "").trim(), db = (b.due_date ?? "").trim();
  if (!da && !db) return (b.created ?? "").localeCompare(a.created ?? "");
  if (!da) return 1;                                     // nulls last
  if (!db) return -1;
  return da.localeCompare(db);                           // due_date asc → overdue first
}

export async function GET(req: Request, { params }: { params: Promise<{ list: string }> }) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { list } = await params;
  if (!FIELDS[list]) return Response.json({ error: "unknown_list" }, { status: 404 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ items: [] }); }
  const pb = pbUrl();
  const filter = encodeURIComponent(`user = "${pbEscape(me.id)}"`);
  // Fetch a bounded window, then apply canonical order server-side, return 10.
  const res = await fetch(`${pb}/api/collections/${list}/records?filter=${filter}&perPage=50&sort=-created&fields=${FIELDS[list]}`, { headers: { Authorization: token } });
  if (!res.ok) return Response.json({ items: [] }); // collection not migrated yet → empty
  const rows = ((await res.json()) as { items?: Row[] }).items ?? [];
  const ordered = list === "leads" ? rows : [...rows].sort(rankByDue);
  return Response.json({ items: ordered.slice(0, 10) });
}
