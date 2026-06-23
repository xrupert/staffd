/**
 * POST /api/stripe/portal
 * Body: { userId }
 * Returns: { url } — the Stripe Customer Portal URL
 *
 * Lets subscribers manage their plan, payment method, or cancel
 * without ever leaving the Stripe-hosted portal.
 */

import Stripe from "stripe";
import { resolveAppUrl } from "../../../../lib/env";
import { pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

async function getAdminToken(pbUrl: string): Promise<string> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error("PocketBase admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!secretKey || !pbUrl) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  // SECURITY (W95.7.3d-h6) — IDOR fix. The billing portal was looked up by a
  // body `userId` via the ADMIN token, so any caller could open ANOTHER user's
  // portal (see invoices, change card, cancel their subscription). Resolve the
  // user from their session token instead; never trust a body userId.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;

  // PR-Tranche-1.6 — resolveAppUrl handles empty-string env (W8 clone fix).
  const origin = resolveAppUrl(req.headers.get("origin"));
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    // Look up Stripe customer ID from PocketBase
    const res = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } }
    );
    const data = (await res.json()) as { items?: Array<{ stripe_customer?: string }> };
    const stripeCustomerId = data.items?.[0]?.stripe_customer;

    if (!stripeCustomerId) {
      return Response.json(
        { error: "No active subscription found. Subscribe to a plan first." },
        { status: 404 }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/dashboard/settings`,
    });

    return Response.json({ url: portalSession.url });
  } catch (err) {
    console.error("Portal session error:", err);
    return Response.json({ error: "Failed to open subscription portal" }, { status: 500 });
  }
}
