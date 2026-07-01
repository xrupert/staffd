/**
 * POST /api/billing/checkout-addon
 * Body: { department }
 * Returns: { url } — checkout URL for the $29/mo department add-on, or a
 * 503 { error: "billing_not_configured" } until a real provider is wired in.
 *
 * Eligibility: Growth and Pro plans only (Agency already has all depts;
 * Starter must upgrade first). Server-side validates plan eligibility.
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

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

export async function POST(req: Request) {
  const { department } = (await req.json()) as { department: string };

  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  if (!department) {
    return Response.json({ error: "department required" }, { status: 400 });
  }
  if (!ADDONABLE.has(department)) {
    return Response.json({ error: "Department not available as add-on" }, { status: 400 });
  }

  const prices = getPrices();
  const priceId = prices["dept-addon_monthly"];
  if (!priceId) {
    return Response.json({ error: "Add-on price not configured." }, { status: 503 });
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const subRes = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
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
        { status: 400 },
      );
    }

    const alreadyHas = (sub.unlocked_departments ?? []).includes(department) ||
                      Object.keys(sub.dept_addon_subs ?? {}).includes(department);
    if (alreadyHas) {
      return Response.json({ error: "You already have this department unlocked." }, { status: 400 });
    }

    const provider = getBillingProvider();
    const session = await provider.createCheckoutSession({
      mode: "subscription",
      priceId,
      customerId: sub.stripe_customer,
      customerEmail: sub.stripe_customer ? undefined : userEmail,
      successUrl: `${origin}/dashboard?addon=success&dept=${department}`,
      cancelUrl: `${origin}/dashboard?addon=cancelled`,
      metadata: { staffd_user_id: userId, staffd_addon_type: "department", staffd_addon_dept: department },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Addon checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
