/**
 * POST /api/billing/checkout
 * Body: { planId, interval }
 * Returns: { url } for redirect providers, or { overlay } — the Paddle.js
 * overlay descriptor (price id + customData) the client opens — or a
 * 503 { error: "billing_not_configured" } until a provider is wired in.
 *
 * See docs/superpowers/specs/2026-06-25-remove-stripe-billing-provider-seam-design.md
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError, checkoutResponse } from "../../_lib/billing/provider";
import { getPaddlePrices } from "../../_lib/billing/prices";

export async function POST(req: Request) {
  const body = (await req.json()) as { planId: string; interval: string };
  const { planId, interval } = body;

  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  // SECURITY (W95.7.3d-h6c) — derive the user from their session token, never a
  // body userId/userEmail.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  if (!planId || !interval) {
    return Response.json({ error: "planId and interval are required" }, { status: 400 });
  }

  const prices = getPaddlePrices();
  const priceKey = `${planId}_${interval}`;
  const priceId = prices[priceKey];
  if (!priceId) {
    return Response.json(
      { error: `No price found for ${priceKey}.` },
      { status: 400 },
    );
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const data = (await res.json()) as { items?: Array<{ paddle_customer?: string }> };
    const customerId = data.items?.[0]?.paddle_customer || undefined;

    const provider = getBillingProvider();
    const intent = await provider.createCheckoutSession({
      mode: "subscription",
      priceId,
      customerId,
      customerEmail: customerId ? undefined : userEmail,
      successUrl: `${origin}/dashboard?checkout=success&plan=${planId}`,
      cancelUrl: `${origin}/dashboard?checkout=cancelled`,
      metadata: { staffd_user_id: userId, staffd_plan: planId },
    });

    return Response.json(checkoutResponse(intent));
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Checkout session error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
