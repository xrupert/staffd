/**
 * POST /api/stripe/checkout-addon
 * Body: { userId, userEmail, department }
 * Returns: { url } — Stripe Checkout URL for the $29/mo department add-on
 *
 * Eligibility: Growth and Pro plans only (Agency already has all depts;
 * Starter must upgrade first). Server-side validates plan eligibility.
 */

import Stripe from "stripe";
import { resolveAppUrl } from "../../../../lib/env";

const ELIGIBLE_PLANS = new Set(["growth", "pro"]);

// Departments that can be purchased as an add-on
// (CEO is intentionally excluded — Pro-exclusive, Agency-included)
const ADDONABLE = new Set(["hr", "finance", "operations", "paid-media", "design", "reputation"]);

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
  const { userId, userEmail, department } = (await req.json()) as {
    userId: string;
    userEmail: string;
    department: string;
  };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!secretKey || !pbUrl) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }
  if (!userId || !department) {
    return Response.json({ error: "userId and department required" }, { status: 400 });
  }
  if (!ADDONABLE.has(department)) {
    return Response.json({ error: "Department not available as add-on" }, { status: 400 });
  }

  const prices = getPrices();
  const priceId = prices["dept-addon_monthly"];
  if (!priceId) {
    return Response.json(
      { error: "Add-on price not configured. Run /api/setup/stripe to provision it." },
      { status: 503 }
    );
  }

  // PR-Tranche-1.6 — resolveAppUrl handles empty-string env (W8 clone fix).
  const origin = resolveAppUrl(req.headers.get("origin"));
  const stripe = new Stripe(secretKey);

  try {
    const adminToken = await getAdminToken(pbUrl);

    // Look up subscription record + verify eligibility
    const subRes = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
      { headers: { Authorization: adminToken } }
    );
    const subData = (await subRes.json()) as {
      items?: Array<{
        plan: string;
        stripe_customer?: string;
        unlocked_departments?: string[];
        dept_addon_subs?: Record<string, string>;
      }>;
    };
    const sub = subData.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found. Subscribe to a plan first." }, { status: 404 });
    }
    if (!ELIGIBLE_PLANS.has(sub.plan)) {
      return Response.json(
        { error: "Department add-ons are only available on Growth or Pro. Agency includes all departments." },
        { status: 400 }
      );
    }

    // Block buying a dept the user already has
    const alreadyHas = (sub.unlocked_departments ?? []).includes(department) ||
                      Object.keys(sub.dept_addon_subs ?? {}).includes(department);
    if (alreadyHas) {
      return Response.json({ error: "You already have this department unlocked." }, { status: 400 });
    }

    // Resolve customer ID (create if missing — should usually exist already)
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
      success_url: `${origin}/dashboard?addon=success&dept=${department}`,
      cancel_url: `${origin}/dashboard?addon=cancelled`,
      metadata: {
        staffd_user_id: userId,
        staffd_addon_type: "department",
        staffd_addon_dept: department,
      },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      subscription_data: {
        metadata: {
          staffd_user_id: userId,
          staffd_addon_type: "department",
          staffd_addon_dept: department,
        },
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Addon checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
