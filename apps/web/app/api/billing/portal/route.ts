/**
 * POST /api/billing/portal
 * Returns: { url } — the billing-provider-hosted customer portal URL, or a
 * 503 { error: "billing_not_configured" } until a real provider is wired in.
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  // SECURITY (W95.7.3d-h6) — resolve the user from their session token, never
  // a body userId (IDOR fix — see original stripe/portal history).
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const data = (await res.json()) as { items?: Array<{ stripe_customer?: string }> };
    const customerId = data.items?.[0]?.stripe_customer;

    if (!customerId) {
      return Response.json(
        { error: "No active subscription found. Subscribe to a plan first." },
        { status: 404 },
      );
    }

    const provider = getBillingProvider();
    const portalSession = await provider.createPortalSession(customerId, `${origin}/dashboard/settings`);
    return Response.json({ url: portalSession.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Portal session error:", err);
    return Response.json({ error: "Failed to open subscription portal" }, { status: 500 });
  }
}
