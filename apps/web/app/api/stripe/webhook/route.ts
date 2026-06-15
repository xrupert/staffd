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
import { addTopupCredits, type CreditKind } from "../../_lib/credits";
import { pbEscape } from "../../_lib/pb";

// Returns 200 for all events even on processing errors —
// otherwise Stripe will retry and we may double-process.
// W47 — additionally, every event id is checked against the
// `stripe_events` ledger before processing, so genuine Stripe
// re-deliveries can never double-credit.

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

/**
 * W47 — webhook idempotency ledger helpers. `wasEventProcessed` is checked
 * before any branch runs; `markEventProcessed` records the event id after
 * successful processing. The ledger collection has a unique index on
 * event_id, so even a race between two concurrent deliveries can only
 * insert once.
 */
async function wasEventProcessed(
  pbUrl: string,
  adminToken: string,
  eventId: string
): Promise<boolean> {
  const res = await fetch(
    `${pbUrl}/api/collections/stripe_events/records?filter=(event_id='${pbEscape(eventId)}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  if (!res.ok) return false; // ledger unavailable — process rather than drop
  const data = (await res.json()) as { items?: Array<{ id: string }> };
  return (data.items?.length ?? 0) > 0;
}

async function markEventProcessed(
  pbUrl: string,
  adminToken: string,
  eventId: string,
  eventType: string,
  userId: string | null
): Promise<void> {
  await fetch(`${pbUrl}/api/collections/stripe_events/records`, {
    method: "POST",
    headers: { Authorization: adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      event_id: eventId,
      event_type: eventType,
      user: userId ?? "",
      processed_at: new Date().toISOString(),
    }),
  });
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
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
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
    `${pbUrl}/api/collections/subscriptions/records?filter=(stripe_customer='${pbEscape(stripeCustomerId)}')&perPage=1`,
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
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
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

/** Phase 8 — add an industry pack to the user's record. */
async function addPackAddonForUser(
  pbUrl: string,
  adminToken: string,
  userId: string,
  packId: string,
  stripeSubId: string
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      industry_packs?: string[];
      pack_addon_subs?: Record<string, string>;
    }>;
  };
  const existing = data.items?.[0];
  if (!existing?.id) return;

  const currentPacks = Array.isArray(existing.industry_packs) ? existing.industry_packs : [];
  const newPacks = currentPacks.includes(packId) ? currentPacks : [...currentPacks, packId];
  const newAddonMap = { ...(existing.pack_addon_subs ?? {}), [packId]: stripeSubId };

  await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      industry_packs: newPacks,
      pack_addon_subs: newAddonMap,
    }),
  });
}

/** Phase 8 — remove an industry pack when its Stripe subscription is cancelled. */
async function removePackAddonByStripeSubId(
  pbUrl: string,
  adminToken: string,
  stripeCustomerId: string,
  stripeSubId: string
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(stripe_customer='${pbEscape(stripeCustomerId)}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      industry_packs?: string[];
      pack_addon_subs?: Record<string, string>;
    }>;
  };
  const existing = data.items?.[0];
  if (!existing?.id) return;

  const addonMap = existing.pack_addon_subs ?? {};
  const packToRemove = Object.entries(addonMap).find(([, id]) => id === stripeSubId)?.[0];
  if (!packToRemove) return;

  const newPacks = (existing.industry_packs ?? []).filter((p) => p !== packToRemove);
  const newAddonMap = { ...addonMap };
  delete newAddonMap[packToRemove];

  await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      industry_packs: newPacks,
      pack_addon_subs: newAddonMap,
    }),
  });
}

/** Set / clear the CEO add-on subscription id on the user's record (Phase 4). */
async function setCeoAddonForUser(
  pbUrl: string,
  adminToken: string,
  userId: string,
  stripeSubId: string | null
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as { items?: Array<{ id: string }> };
  const existing = data.items?.[0];
  if (!existing?.id) return;
  await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ceo_addon_sub: stripeSubId ?? "" }),
  });
}

/** Clear the CEO add-on by Stripe sub id when the subscription is cancelled. */
async function clearCeoAddonByStripeSubId(
  pbUrl: string,
  adminToken: string,
  stripeCustomerId: string,
  stripeSubId: string
) {
  const headers = { Authorization: adminToken, "Content-Type": "application/json" };
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(stripe_customer='${pbEscape(stripeCustomerId)}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  const data = (await res.json()) as { items?: Array<{ id: string; ceo_addon_sub?: string }> };
  const existing = data.items?.[0];
  if (!existing?.id) return;
  // Only clear if the cancelled sub matches what we recorded.
  if (existing.ceo_addon_sub && existing.ceo_addon_sub !== stripeSubId) return;
  await fetch(`${pbUrl}/api/collections/subscriptions/records/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ceo_addon_sub: "" }),
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
    `${pbUrl}/api/collections/subscriptions/records?filter=(stripe_customer='${pbEscape(stripeCustomerId)}')&perPage=1`,
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

    // W47 — idempotency gate. Applies to EVERY branch, not just top-ups.
    if (await wasEventProcessed(pbUrl, adminToken, event.id)) {
      console.log(`[stripe.webhook] duplicate event ignored event_id=${event.id}`);
      return Response.json({ received: true, duplicate: true });
    }

    switch (event.type) {

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = session.metadata?.staffd_user_id;
        const customerId = typeof session.customer === "string" ? session.customer : null;
        const subId      = typeof session.subscription === "string" ? session.subscription : null;
        const addonType  = session.metadata?.staffd_addon_type;
        const addonDept  = session.metadata?.staffd_addon_dept;
        const plan       = session.metadata?.staffd_plan;
        const topupPack    = session.metadata?.staffd_topup_pack;
        const topupType    = session.metadata?.topup_type;
        const creditCount  = Number.parseInt(session.metadata?.credit_count ?? "0", 10);
        const legacyCredits = Number.parseInt(session.metadata?.staffd_topup_credits ?? "0", 10);

        if (!userId) break;

        // W47 — one-time credit top-up. mode === "payment" path. Routes by
        // metadata.topup_type to the image or video bucket per ARCH §12.
        if (session.mode === "payment") {
          if ((topupType === "image" || topupType === "video") && creditCount > 0) {
            await addTopupCredits(pbUrl, userId, topupType as CreditKind, creditCount);
            console.log(`[stripe.webhook] topup credited user=${userId} type=${topupType} credits=${creditCount}`);
            break;
          }
          // W47-legacy shim — checkout sessions created before the SKU
          // realignment carry staffd_topup_pack + staffd_topup_credits but
          // no topup_type. SA ruling (Phase B Q6): mint to image credits.
          if (topupPack && !topupType && legacyCredits > 0) {
            await addTopupCredits(pbUrl, userId, "image", legacyCredits);
            console.log(`[W47-legacy] minted image credits for legacy session=${session.id} pack=${topupPack} credits=${legacyCredits}`);
            break;
          }
          // Unknown shape — log loudly, mint nothing, return 200 via the
          // normal exit so Stripe doesn't retry a malformed event forever.
          console.error(`[stripe.webhook] unknown topup metadata shape session=${session.id}`);
          break;
        }

        if (session.mode !== "subscription") break;
        if (!customerId) break;

        // Department add-on — unlock the dept, track sub_id, don't touch plan.
        if (addonType === "department" && addonDept && subId) {
          await addDeptAddonForUser(pbUrl, adminToken, userId, addonDept, subId);
          break;
        }

        // Phase 4 — CEO add-on. Don't touch plan; set ceo_addon_sub instead.
        if (addonType === "ceo" && subId) {
          await setCeoAddonForUser(pbUrl, adminToken, userId, subId);
          console.log(`[stripe.webhook] ceo addon activated user=${userId} sub=${subId}`);
          break;
        }

        // Phase 8 — industry pack. Append pack id + sub mapping; plan untouched.
        if (addonType === "industry_pack" && subId) {
          const packId = session.metadata?.staffd_pack_id;
          if (packId) {
            await addPackAddonForUser(pbUrl, adminToken, userId, packId, subId);
            console.log(`[stripe.webhook] industry pack activated user=${userId} pack=${packId} sub=${subId}`);
          }
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
        if (sub.metadata?.staffd_addon_type === "ceo") break;
        if (sub.metadata?.staffd_addon_type === "industry_pack") break;

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

        // Phase 4 — CEO add-on cancellation. Clear ceo_addon_sub; plan untouched.
        if (sub.metadata?.staffd_addon_type === "ceo") {
          await clearCeoAddonByStripeSubId(pbUrl, adminToken, customerId, sub.id);
          console.log(`[stripe.webhook] ceo addon cancelled customer=${customerId} sub=${sub.id}`);
          break;
        }

        // Phase 8 — industry pack cancellation. Remove pack id + clear mapping.
        if (sub.metadata?.staffd_addon_type === "industry_pack") {
          await removePackAddonByStripeSubId(pbUrl, adminToken, customerId, sub.id);
          console.log(`[stripe.webhook] industry pack cancelled customer=${customerId} sub=${sub.id}`);
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

    // W47 — record the event id only after the branch processed without
    // throwing. A failed run stays unrecorded so a Stripe retry can
    // reprocess it.
    const eventObj = event.data.object as { metadata?: Record<string, string> } | undefined;
    await markEventProcessed(
      pbUrl,
      adminToken,
      event.id,
      event.type,
      eventObj?.metadata?.staffd_user_id ?? null
    );
  } catch (err) {
    // Log but return 200 — don't let Stripe retry on our processing errors
    console.error("Webhook processing error:", err);
  }

  return Response.json({ received: true });
}
