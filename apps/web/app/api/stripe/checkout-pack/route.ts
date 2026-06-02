/**
 * POST /api/stripe/checkout-pack
 * Body: { userId, userEmail, packId }
 * Returns: { url } — Stripe Checkout URL for a $19/mo industry pack subscription.
 *
 * Eligibility: any user with an active subscription record (the pack is
 * additive — doesn't replace the plan). Blocks duplicate purchases via the
 * `pack_addon_subs` map.
 *
 * Webhook (`stripe/webhook/route.ts`) consumes `staffd_addon_type: "industry_pack"`
 * metadata to set `industry_packs` + `pack_addon_subs[packId]` on the user's
 * PB subscription record.
 */

import Stripe from "stripe";
import { PACK_IDS } from "@staffd/agents";

const ALLOWED_PACK_IDS = new Set<string>(PACK_IDS as readonly string[]);

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
  const { userId, userEmail, packId } = (await req.json()) as {
    userId: string;
    userEmail: string;
    packId: string;
  };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!secretKey || !pbUrl) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }
  if (!userId || !packId) {
    return Response.json({ error: "userId and packId required" }, { status: 400 });
  }
  if (!ALLOWED_PACK_IDS.has(packId)) {
    return Response.json({ error: "Unknown pack" }, { status: 400 });
  }

  // STRIPE_PRICES key shape: "pack-<id>_monthly" — matches setup/stripe.
  const prices = getPrices();
  const priceId = prices[`pack-${packId}_monthly`];
  if (!priceId) {
    return Response.json(
      { error: "Pack price not configured. Run /api/setup/stripe to provision it." },
      { status: 503 }
    );
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://urstaffd.com";
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    const subRes = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
      { headers: { Authorization: adminToken } }
    );
    const subData = (await subRes.json()) as {
      items?: Array<{
        plan: string;
        stripe_customer?: string;
        industry_packs?: string[] | null;
        pack_addon_subs?: Record<string, string> | null;
      }>;
    };
    const sub = subData.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found. Subscribe to a plan first." }, { status: 404 });
    }

    // Block duplicate purchase.
    const already = (sub.industry_packs ?? []).includes(packId)
      || Object.keys(sub.pack_addon_subs ?? {}).includes(packId);
    if (already) {
      return Response.json({ error: "This pack is already active on your account." }, { status: 400 });
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
      success_url: `${origin}/dashboard/settings?pack=success&pack_id=${packId}`,
      cancel_url: `${origin}/dashboard/settings?pack=cancelled`,
      metadata: {
        staffd_user_id: userId,
        staffd_addon_type: "industry_pack",
        staffd_pack_id: packId,
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      subscription_data: {
        metadata: {
          staffd_user_id: userId,
          staffd_addon_type: "industry_pack",
          staffd_pack_id: packId,
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Pack checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
