/**
 * GET /api/integrations/postiz — the caller's connected social channels.
 *
 * Owner-authed (whoAmI). Credentials resolve per user via resolveCredentials
 * ("postiz"): the user's own Postiz org key wins; the operator env fallback is
 * super-admin-only. 503 not_configured when nothing is connected — the UI
 * shows "connect social publishing", never an error.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { PostizClient } from "../../_lib/integrations/postiz/client";

const NOT_CONFIGURED = {
  error: "not_configured",
  message: "Social publishing isn't connected yet. Add your Postiz URL and API key in Settings → Connect Your Tools.",
};

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const client = await PostizClient.forCustomer(me.id);
  if (!client) return Response.json(NOT_CONFIGURED, { status: 503 });

  try {
    const channels = await client.listChannels();
    return Response.json({ ok: true, channels });
  } catch (err) {
    console.error("[integrations/postiz] list error:", err);
    return Response.json({ error: "Failed to reach social publishing" }, { status: 502 });
  }
}
