/**
 * POST /api/stripe/checkout-topup
 * Body: { userId, userEmail, pack } where pack ∈ TOPUP_PACK_IDS
 * Returns: { url } — Stripe Checkout URL for a one-time credit pack
 *
 * Maps the requested pack to its Stripe price id via `STRIPE_PRICES`
 * (provisioned by /api/setup/stripe). Carries the credit quantity in
 * session metadata so the webhook can credit the user without a second
 * lookup. Mode is `payment` (one-time), not `subscription`.
 */

import Stripe from "stripe";
import { resolveAppUrl } from "../../../../lib/env";

const TOPUP_PACK_IDS = new Set([
  "topup-100", "topup-250", "topup-500",
  "topup-1000", "topup-2500", "topup-5000",
]);

const TOPUP_CREDIT_QUANTITY: Record<string, number> = {
  "topup-100":  100,
  "topup-250":  250,
  "topup-500":  500,
  "topup-1000": 1000,
  "topup-2500": 2500,
  "topup-5000": 5000,
};

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
  const { userId, userEmail, pack } = (await req.json()) as {
    userId: string;
    userEmail: string;
    pack: string;
  };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!secretKey || !pbUrl) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }
  if (!userId || !pack) {
    return Response.json({ error: "userId and pack required" }, { status: 400 });
  }
  if (!TOPUP_PACK_IDS.has(pack)) {
    return Response.json({ error: "Unknown top-up pack" }, { status: 400 });
  }

  const prices = getPrices();
  const priceId = prices[`${pack}_oneoff`];
  if (!priceId) {
    return Response.json(
      { error: `Top-up price not configured for ${pack}. Run /api/setup/stripe.` },
      { status: 503 }
    );
  }

  const credits = TOPUP_CREDIT_QUANTITY[pack];
  if (!credits) {
    return Response.json({ error: "Pack credit quantity unmapped" }, { status: 500 });
  }

  // PR-Tranche-1.6 — resolveAppUrl handles empty-string env (W8 clone fix).
  const origin = resolveAppUrl(req.headers.get("origin"));
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    // Reuse the user's stripe_customer if we have one so the user keeps a
    // single Stripe identity across plans + add-ons + top-ups.
    const subRes = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
      { headers: { Authorization: adminToken } }
    );
    const subData = (await subRes.json()) as { items?: Array<{ stripe_customer?: string }> };
    let customerId = subData.items?.[0]?.stripe_customer;
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
      mode: "payment", // ONE-TIME — not subscription
      success_url: `${origin}/dashboard?topup=success&pack=${pack}`,
      cancel_url: `${origin}/dashboard?topup=cancelled`,
      metadata: {
        staffd_user_id: userId,
        staffd_topup_pack: pack,
        staffd_topup_credits: String(credits),
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      payment_intent_data: {
        metadata: {
          staffd_user_id: userId,
          staffd_topup_pack: pack,
          staffd_topup_credits: String(credits),
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Topup checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
