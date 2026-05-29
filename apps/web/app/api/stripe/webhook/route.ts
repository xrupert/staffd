/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe events and syncs subscription state to PocketBase.
 * Stripe signature is verified on every request.
 *
 * Events handled:
 *   checkout.session.completed     → creates/updates subscription record
 *   customer.subscription.updated  → updates plan on upgrade/downgrade
 *   customer.subscription.deleted  → reverts to starter plan on cancellation
 */

import Stripe from "stripe";

// Returns 200 for all events even on processing errors —
// otherwise Stripe will retry and we may double-process.

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function getPlanFromPriceId(priceId: string): string | null {
  const prices = getPrices();
  for (const [key, id] of Object.entries(prices)) {
    if (id === priceId) {
      // key format is "starter_monthly" or "growth_annual"
      return key.split("_")[0] ?? null;
    }
  }
  return null;
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

interface SubUpdate {
  plan?: string;
  stripe_customer?: string;
  stripe_sub_id?: string;
  active_until?: string;
}

async function upsertSubscriptionForUser(
  pbUrl: string,
  adminToken: string,
  userId: string,
  update: SubUpdate
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };

  // Find existing record
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as { items?: Array<{ id: string }> };
  const existing = data.items?.[0];

  if (existing?.id) {
    await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(update),
    });
  } else {
    await fetch(`${pbUrl}/api/collections/subscriptions/records`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user: userId, trial_runs: {}, ...update }),
    });
  }
}

async function updateSubscriptionByCustomer(
  pbUrl: string,
  adminToken: string,
  stripeCustomerId: string,
  update: SubUpdate
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };

  // Find subscription by stripe_customer field
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(stripe_customer='${stripeCustomerId}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as { items?: Array<{ id: string }> };
  const existing = data.items?.[0];

  if (existing?.id) {
    await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(update),
    });
  }
}

/** Add a department to the user's unlocked list and store the add-on Stripe sub_id. */
async function addDeptAddonForUser(
  pbUrl: string,
  adminToken: string,
  userId: string,
  department: string,
  stripeSubId: string
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };

  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      unlocked_departments?: string[];
      dept_addon_subs?: Record<string, string>;
    }>;
  };
  const existing = data.items?.[0];
  if (!existing?.id) return; // no subscription record — addon checkout shouldn't have succeeded anyway

  const currentDepts = existing.unlocked_departments ?? [];
  const newDepts = currentDepts.includes(department) ? currentDepts : [...currentDepts, department];
  const newAddonMap = { ...(existing.dept_addon_subs ?? {}), [department]: stripeSubId };

  await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      unlocked_departments: newDepts,
      dept_addon_subs: newAddonMap,
    }),
  });
}

/** Remove a department from the user's unlocked list when its add-on sub is cancelled. */
async function removeDeptAddonByStripeSubId(
  pbUrl: string,
  adminToken: string,
  stripeCustomerId: string,
  stripeSubId: string
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };

  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(stripe_customer='${stripeCustomerId}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      unlocked_departments?: string[];
      dept_addon_subs?: Record<string, string>;
    }>;
  };
  const existing = data.items?.[0];
  if (!existing?.id) return;

  const addonMap = existing.dept_addon_subs ?? {};
  // Find which department this sub_id belonged to
  const deptToRemove = Object.entries(addonMap).find(([, id]) => id === stripeSubId)?.[0];
  if (!deptToRemove) return;

  const newDepts = (existing.unlocked_departments ?? []).filter((d) => d !== deptToRemove);
  const newAddonMap = { ...addonMap };
  delete newAddonMap[deptToRemove];

  await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      unlocked_departments: newDepts,
      dept_addon_subs: newAddonMap,
    }),
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

  if (!webhookSecret || !secretKey || !pbUrl) {
    return Response.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    const adminToken = await getAdminToken(pbUrl);

    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId = session.metadata?.staffd_user_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        const subId      = typeof session.subscription === "string" ? session.subscription : null;
        const addonType  = session.metadata?.staffd_addon_type;
        const addonDept  = session.metadata?.staffd_addon_dept;
        const plan       = session.metadata?.staffd_plan;

        if (!userId || !customerId) break;

        // Add-on checkout — unlock a department, track the sub_id, don't touch the plan
        if (addonType === "department" && addonDept && subId) {
          await addDeptAddonForUser(pbUrl, adminToken, userId, addonDept, subId);
          break;
        }

        // Standard plan checkout
        if (!plan) break;
        await upsertSubscriptionForUser(pbUrl, adminToken, userId, {
          plan,
          stripe_customer: customerId,
          stripe_sub_id: subId ?? undefined,
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : "";
        if (!customerId) break;

        // Skip — add-on subs don't change the plan
        if (sub.metadata?.staffd_addon_type === "department") break;

        const priceId = sub.items.data[0]?.price.id ?? "";
        const plan    = getPlanFromPriceId(priceId);
        if (!plan) break;

        // Calculate active_until from current period end
        const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
        const activeUntil = periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined;

        await updateSubscriptionByCustomer(pbUrl, adminToken, customerId, {
          plan,
          stripe_sub_id: sub.id,
          active_until: activeUntil,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : "";
        if (!customerId) break;

        // Add-on cancellation — just remove the department, don't touch the plan
        if (sub.metadata?.staffd_addon_type === "department") {
          await removeDeptAddonByStripeSubId(pbUrl, adminToken, customerId, sub.id);
          break;
        }

        // Standard plan cancellation — revert to starter
        await updateSubscriptionByCustomer(pbUrl, adminToken, customerId, {
          plan: "starter",
          stripe_sub_id: undefined,
          active_until: undefined,
        });
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }
  } catch (err) {
    // Log but return 200 — don't let Stripe retry on our processing errors
    console.error("Webhook processing error:", err);
  }

  return Response.json({ received: true });
}
