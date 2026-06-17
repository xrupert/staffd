/**
 * GET /api/upload/sessions — the authed owner's recent upload history (W95.3).
 *
 * Drives the /dashboard/upload "recent uploads" list. USER_OWNED data; we read
 * via the admin token but always filter to the caller's own id. Returns the
 * last 5. Gracefully returns an empty list if the collection isn't set up yet.
 */

import { getAdminToken, pbUrl, pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ sessions: [] }); }
  const pb = pbUrl();

  const filter = encodeURIComponent(`user = "${pbEscape(me.id)}"`);
  const res = await fetch(
    `${pb}/api/collections/upload_sessions/records?filter=${filter}&perPage=5&sort=-created&fields=id,kind,file_count,row_count,succeeded,failed,summary,created`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return Response.json({ sessions: [] }); // collection not set up yet → empty
  const data = (await res.json()) as { items?: unknown[] };
  return Response.json({ sessions: data.items ?? [] });
}
