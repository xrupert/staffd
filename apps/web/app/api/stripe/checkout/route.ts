/**
 * POST /api/stripe/checkout
 * Body: { planId, interval, userId, userEmail }
 * Returns: { url } — the Stripe-hosted checkout page URL
 *
 * Creates or reuses a Stripe Customer tied to the user's PocketBase ID,
 * then opens a Checkout Session for the requested plan + billing interval.
 */

import Stripe from "stripe";

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

async function getOrCreateStripeCustomer(
  stripe: Stripe,
  pbUrl: string,
  adminToken: string,
  userId: string,
  email: string
): Promise<string> {
  // Look for an existing subscription record with a Stripe customer ID
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as { items?: Array<{ stripe_customer?: string }> };
  const existing = data.items?.[0]?.stripe_customer;
  if (existing) return existing;

  // Create a new Stripe Customer
  const customer = await stripe.customers.create({
    email,
    metadata: { staffd_user_id: userId },
  });
  return customer.id;
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    planId: string;
    interval: string;
    userId: string;
    userEmail: string;
  };
  const { planId, interval, userId, userEmail } = body;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!secretKey || !pbUrl) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }
  if (!planId || !interval || !userId) {
    return Response.json({ error: "planId, interval, and userId are required" }, { status: 400 });
  }

  const prices = getPrices();
  const priceKey = `${planId}_${interval}`;
  const priceId = prices[priceKey];

  if (!priceId) {
    return Response.json(
      { error: `No price found for ${priceKey}. Run /api/setup/stripe first.` },
      { status: 400 }
    );
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://urstaffd.com";
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);
    const customerId = await getOrCreateStripeCustomer(stripe, pbUrl, adminToken, userId, userEmail ?? "");

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/dashboard?checkout=success&plan=${planId}`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
      metadata: { staffd_user_id: userId, staffd_plan: planId },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      subscription_data: {
        metadata: { staffd_user_id: userId, staffd_plan: planId },
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
