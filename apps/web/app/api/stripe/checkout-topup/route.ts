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
import { pbEscape } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

// W47 — §3-aligned typed packs. Route translates the pack id into
// topup_type + credit_count session metadata; the webhook routes by type.
const TOPUP_PACKS: Record<string, { type: "image" | "video"; count: number }> = {
  "topup-img-50":  { type: "image", count: 50  },
  "topup-img-150": { type: "image", count: 150 },
  "topup-img-350": { type: "image", count: 350 },
  "topup-vid-10":  { type: "video", count: 10  },
  "topup-vid-25":  { type: "video", count: 25  },
  "topup-vid-50":  { type: "video", count: 50  },
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
  const { pack } = (await req.json()) as { pack: string };

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

  if (!pack) {
    return Response.json({ error: "pack required" }, { status: 400 });
  }
  const packDef = TOPUP_PACKS[pack];
  if (!packDef) {
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

  // PR-Tranche-1.6 — resolveAppUrl handles empty-string env (W8 clone fix).
  const origin = resolveAppUrl(req.headers.get("origin"));
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    // Reuse the user's stripe_customer if we have one so the user keeps a
    // single Stripe identity across plans + add-ons + top-ups.
    const subRes = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
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
        topup_type: packDef.type,
        credit_count: String(packDef.count),
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      payment_intent_data: {
        metadata: {
          staffd_user_id: userId,
          staffd_topup_pack: pack,
          topup_type: packDef.type,
          credit_count: String(packDef.count),
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Topup checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
