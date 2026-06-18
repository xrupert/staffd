/**
 * GET /api/front-desk/summary (W95.4a) — small per-owner counts for the Front
 * Desk "your work" cards: open tasks, upcoming/overdue follow-ups, leads by
 * status. USER-scoped (admin token + user filter). O(1) totalItems counts.
 */

import { getAdminToken, pbUrl, pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

async function count(pb: string, token: string, collection: string, filter: string): Promise<number> {
  const res = await fetch(`${pb}/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}&perPage=1&fields=id`, { headers: { Authorization: token } });
  if (!res.ok) return 0;
  return ((await res.json()) as { totalItems?: number }).totalItems ?? 0;
}

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();
  const u = `user = "${pbEscape(me.id)}"`;
  const today = new Date().toISOString();

  const [tasksPending, followupsPending, followupsOverdue, leadsNew, leadsQualified, leadsConverted] = await Promise.all([
    count(pb, token, "tasks", `${u} && status = "pending"`),
    count(pb, token, "followups", `${u} && status = "pending"`),
    count(pb, token, "followups", `${u} && status = "pending" && due_date != "" && due_date < "${pbEscape(today)}"`),
    count(pb, token, "leads", `${u} && status = "new"`),
    count(pb, token, "leads", `${u} && status = "qualified"`),
    count(pb, token, "leads", `${u} && status = "converted"`),
  ]);

  return Response.json({
    tasks: { pending: tasksPending },
    followups: { upcoming: followupsPending, overdue: followupsOverdue },
    leads: { new: leadsNew, qualified: leadsQualified, converted: leadsConverted },
  });
}
