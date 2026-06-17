/**
 * GET /api/user-integrations — the authed user's saved integrations, one
 * entry per configured vendor. Returns status + masked key + url +
 * last_verified_at. NEVER returns the decrypted api_key. (W91)
 */

import { getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import { whoAmI } from "../_lib/integrations/identity";
import { maskKey } from "../_lib/integrations/crypto";
import { INTEGRATION_TYPES } from "../_lib/integrations/resolve";

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }

  const filter = `(user = "${pbEscape(me.id)}")`;
  const res = await fetch(
    `${pbUrl()}/api/collections/user_integrations/records?filter=${encodeURIComponent(filter)}&perPage=50&fields=integration_type,connection_url,additional_config,status,last_verified_at,last_error`,
    { headers: { Authorization: token } },
  );
  type Row = { integration_type: string; connection_url?: string; additional_config?: Record<string, unknown>; status?: string; last_verified_at?: string; last_error?: string };
  const rows = res.ok ? ((await res.json()) as { items?: Row[] }).items ?? [] : [];
  const byType = new Map(rows.map((r) => [r.integration_type, r]));

  const integrations = INTEGRATION_TYPES.map((type) => {
    const r = byType.get(type);
    const cfg = (r?.additional_config ?? {}) as Record<string, unknown>;
    const { key_last4, ...config } = cfg as { key_last4?: string };
    return {
      type,
      status: r?.status ?? "disconnected",
      masked_key: maskKey(typeof key_last4 === "string" ? key_last4 : null),
      url: r?.connection_url ?? "",
      config,
      last_verified_at: r?.last_verified_at ?? null,
      last_error: r?.last_error ?? null,
    };
  });

  return Response.json({ integrations });
}
