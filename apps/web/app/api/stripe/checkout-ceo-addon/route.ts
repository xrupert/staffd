/**
 * POST /api/stripe/checkout-ceo-addon
 * Body: { userId, userEmail }
 * Returns: { url } — Stripe Checkout URL for the $49/mo CEO add-on subscription
 *
 * Eligibility (Phase 4):
 *   Starter and Growth users only. Pro and Agency already include the CEO
 *   in-plan, so the checkout 400s with a helpful message rather than
 *   creating a duplicate subscription.
 *
 * Webhook (stripe/webhook/route.ts) consumes `staffd_addon_type: "ceo"`
 * metadata on the resulting subscription to set `ceo_addon_sub` on the
 * user's PB subscription record. Trial.ts:resolveUnlocked then unlocks the
 * "ceo" department without touching the user's plan field.
 */

import Stripe from "stripe";
import { resolveAppUrl } from "../../../../lib/env";
import { pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

const ELIGIBLE_PLANS = new Set(["starter", "growth"]);

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

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

  // SECURITY (W95.7.3d-h6c) — user from session token, not a body userId/email.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  const prices = getPrices();
  const priceId = prices["ceo-addon_monthly"];
  if (!priceId) {
    return Response.json(
      { error: "CEO add-on price not configured. Run /api/setup/stripe to provision it." },
      { status: 503 }
    );
  }

  // PR-Tranche-1.6 — resolveAppUrl handles empty-string env (W8 clone fix).
  const origin = resolveAppUrl(req.headers.get("origin"));
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    const subRes = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } }
    );
    const subData = (await subRes.json()) as {
      items?: Array<{ plan: string; stripe_customer?: string; ceo_addon_sub?: string }>;
    };
    const sub = subData.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found. Subscribe to a plan first." }, { status: 404 });
    }
    if (!ELIGIBLE_PLANS.has(sub.plan)) {
      return Response.json(
        { error: "The CEO is already included in Pro and Agency plans." },
        { status: 400 }
      );
    }
    if (sub.ceo_addon_sub) {
      return Response.json({ error: "CEO add-on is already active on this account." }, { status: 400 });
    }

    let customerId = sub.stripe_customer;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail ?? "",
        metadata: { staffd_user_id: userId },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/dashboard?addon=ceo-success`,
      cancel_url: `${origin}/dashboard?addon=cancelled`,
      metadata: {
        staffd_user_id: userId,
        staffd_addon_type: "ceo",
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      subscription_data: {
        metadata: {
          staffd_user_id: userId,
          staffd_addon_type: "ceo",
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("CEO addon checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
