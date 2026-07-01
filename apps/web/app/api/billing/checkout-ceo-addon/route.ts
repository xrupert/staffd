/**
 * POST /api/billing/checkout-ceo-addon
 * Returns: { url } — checkout URL for the $49/mo CEO add-on, or a 503
 * { error: "billing_not_configured" } until a real provider is wired in.
 *
 * Eligibility: Starter and Growth users only. Pro and Agency already
 * include the CEO in-plan.
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

const ELIGIBLE_PLANS = new Set(["starter", "growth"]);

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  const prices = getPrices();
  const priceId = prices["ceo-addon_monthly"];
  if (!priceId) {
    return Response.json({ error: "CEO add-on price not configured." }, { status: 503 });
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const subRes = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const subData = (await subRes.json()) as {
      items?: Array<{ plan: string; stripe_customer?: string; ceo_addon_sub?: string }>;
    };
    const sub = subData.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found. Subscribe to a plan first." }, { status: 404 });
    }
    if (!ELIGIBLE_PLANS.has(sub.plan)) {
      return Response.json({ error: "The CEO is already included in Pro and Agency plans." }, { status: 400 });
    }
    if (sub.ceo_addon_sub) {
      return Response.json({ error: "CEO add-on is already active on this account." }, { status: 400 });
    }

    const provider = getBillingProvider();
    const session = await provider.createCheckoutSession({
      mode: "subscription",
      priceId,
      customerId: sub.stripe_customer,
      customerEmail: sub.stripe_customer ? undefined : userEmail,
      successUrl: `${origin}/dashboard?addon=ceo-success`,
      cancelUrl: `${origin}/dashboard?addon=cancelled`,
      metadata: { staffd_user_id: userId, staffd_addon_type: "ceo" },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("CEO addon checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
