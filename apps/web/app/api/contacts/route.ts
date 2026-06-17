/**
 * GET /api/contacts — the authed user's STAFFD-native contacts (W95.1).
 *
 * Powers the Front Desk Sales Pipeline card under Model B3: count + most
 * recent name. Reads the partitioned STAFFD source of truth (not the vendor
 * backend). USER_OWNED rules isolate; we also filter by user defensively.
 */

import { getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import { whoAmI } from "../_lib/integrations/identity";

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }

  const filter = encodeURIComponent(`(user = "${pbEscape(me.id)}")`);
  const res = await fetch(
    `${pbUrl()}/api/collections/contacts/records?filter=${filter}&perPage=5&sort=-created&fields=name,created`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return Response.json({ total: 0, recentName: null, contacts: [] });
  const data = (await res.json()) as { totalItems?: number; items?: { name?: string; created?: string }[] };
  const items = data.items ?? [];
  return Response.json({
    total: data.totalItems ?? items.length,
    recentName: items[0]?.name ?? null,
    contacts: items.map((c) => ({ name: c.name ?? "Unnamed", created: c.created ?? null })),
  });
}
