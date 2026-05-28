/**
 * POST /api/stripe/portal
 * Body: { userId }
 * Returns: { url } — the Stripe Customer Portal URL
 *
 * Lets subscribers manage their plan, payment method, or cancel
 * without ever leaving the Stripe-hosted portal.
 */

import Stripe from "stripe";

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
  const { userId } = (await req.json()) as { userId: string };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!secretKey || !pbUrl) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }
  if (!userId) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://urstaffd.com";
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    // Look up Stripe customer ID from PocketBase
    const res = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
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
