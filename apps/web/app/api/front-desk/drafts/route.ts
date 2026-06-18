/**
 * GET /api/front-desk/drafts (W95.6.x) — this owner's workflows paused at the
 * review step (status = awaiting_review), newest first, top 10. Powers the
 * "Drafts awaiting your review" card + page. USER-scoped.
 */

import { getAdminToken, pbUrl, pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

const LABEL: Record<string, string> = { reply_to_ticket: "Reply", send_for_signature: "Contract" };

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ drafts: [] }); }
  const pb = pbUrl();
  const filter = encodeURIComponent(`user = "${pbEscape(me.id)}" && status = "awaiting_review"`);
  const res = await fetch(`${pb}/api/collections/workflows/records?filter=${filter}&perPage=10&sort=-created&fields=id,recipe_id,root_goal,draft_output,created`, { headers: { Authorization: token } });
  if (!res.ok) return Response.json({ drafts: [] }); // not migrated yet → empty
  const rows = ((await res.json()) as { items?: Record<string, string>[] }).items ?? [];
  const drafts = rows.map((r) => ({
    id: r.id,
    kind: LABEL[r.recipe_id ?? ""] ?? "Draft",
    intent: r.recipe_id ?? "",
    goal: r.root_goal ?? "",
    preview: (r.draft_output ?? "").slice(0, 100),
    draft: r.draft_output ?? "",
    created: r.created,
  }));
  return Response.json({ drafts });
}
