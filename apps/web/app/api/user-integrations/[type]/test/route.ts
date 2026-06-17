/**
 * POST /api/user-integrations/[type]/test — live-verify the authed user's
 * stored creds with a minimal vendor read, then persist the verdict
 * (status + last_verified_at + last_error). (W91)
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../../_lib/pb";
import { whoAmI } from "../../../_lib/integrations/identity";
import { resolveCredentials, INTEGRATION_TYPES, type IntegrationType } from "../../../_lib/integrations/resolve";
import { testConnection } from "../../../_lib/integrations/test-connection";

type RouteContext = { params: Promise<{ type: string }> };

function isType(t: string): t is IntegrationType {
  return (INTEGRATION_TYPES as string[]).includes(t);
}

export async function POST(req: Request, { params }: RouteContext) {
  const { type } = await params;
  if (!isType(type)) return Response.json({ error: "unknown_integration" }, { status: 400 });

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const resolved = await resolveCredentials(me, type);
  if (!resolved) return Response.json({ connected: false, error: "No credentials configured." }, { status: 400 });

  const result = await testConnection(type, resolved);
  const now = new Date().toISOString();

  // Persist the verdict on the user's row (only when it's their own creds —
  // operator-env fallback has no row to update).
  if (resolved.source === "user") {
    try {
      const token = await getAdminToken();
      const filter = `(user = "${pbEscape(me.id)}" && integration_type = "${pbEscape(type)}")`;
      const findRes = await fetch(
        `${pbUrl()}/api/collections/user_integrations/records?filter=${encodeURIComponent(filter)}&perPage=1&fields=id`,
        { headers: { Authorization: token } },
      );
      const row = findRes.ok ? ((await findRes.json()) as { items?: { id: string }[] }).items?.[0] : null;
      if (row) {
        await fetch(`${pbUrl()}/api/collections/user_integrations/records/${row.id}`, {
          method: "PATCH",
          headers: adminHeaders(token),
          body: JSON.stringify({
            status: result.ok ? "connected" : "error",
            last_verified_at: now,
            last_error: result.ok ? "" : (result.error ?? "connection failed"),
          }),
        });
      }
    } catch {
      /* persistence is best-effort; the verdict still returns to the user */
    }
  }

  return Response.json({ connected: result.ok, error: result.error, last_verified_at: now });
}
