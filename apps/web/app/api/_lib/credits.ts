/**
 * Credit system — tracks monthly image/video generation limits per user.
 *
 * Each plan ships with a monthly allocation. When a user runs out of monthly
 * credits, top-ups (purchased separately via Stripe one-time payments) are
 * consumed next. Monthly credits reset on the 1st of each calendar month.
 *
 * Comped users (jrw-solutions) get 100× the Agency allocation — effectively
 * unlimited for any realistic use.
 */

import { isCompedUser } from "./comp";

export type CreditKind = "image" | "video";

export const PLAN_CREDITS: Record<string, { image: number; video: number }> = {
  starter: { image: 100,  video: 5  },
  growth:  { image: 300,  video: 10 },
  pro:     { image: 600,  video: 20 },
  agency:  { image: 1800, video: 60 },
};

/** Comp users get 100× Agency so they never hit the wall in real testing. */
const COMP_MULTIPLIER = 100;

interface SubscriptionRecord {
  id: string;
  plan?: string;
  image_credits_used?: number;
  video_credits_used?: number;
  image_credits_topup?: number;
  video_credits_topup?: number;
  /**
   * @deprecated W47 — generic agent credits are dead per ARCH §12 (specialist
   * conversations are unlimited). No reads or writes remain; any legacy
   * balance is lazily migrated into image_credits_topup on credit-state read.
   * W47.1 will drop the column after 30 days of confirmed zero writes.
   */
  agent_credits_topup?: number;
  ceo_addon_sub?: string;         // Phase 4 — set when CEO add-on subscription is active
  credits_reset_at?: string;      // ISO date — first day of current credit month
}

interface CreditState {
  plan: string;
  monthlyAllowance: { image: number; video: number };
  monthlyUsed: { image: number; video: number };
  topupBalance: { image: number; video: number };
  monthlyRemaining: { image: number; video: number };
  totalRemaining: { image: number; video: number };
  ceoAddonActive: boolean;
}

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
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

async function fetchSubscription(
  pbUrl: string,
  adminToken: string,
  userId: string
): Promise<SubscriptionRecord | null> {
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
    { headers: { Authorization: adminToken } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: SubscriptionRecord[] };
  return data.items?.[0] ?? null;
}

/**
 * Lazy monthly reset — if the stored reset date is from a previous month,
 * zero out the monthly counters and update the reset date.
 */
async function resetIfNewMonth(
  pbUrl: string,
  adminToken: string,
  sub: SubscriptionRecord
): Promise<SubscriptionRecord> {
  const expected = currentMonthIso();
  if ((sub.credits_reset_at ?? "") === expected) return sub;

  const patched: SubscriptionRecord = {
    ...sub,
    image_credits_used: 0,
    video_credits_used: 0,
    credits_reset_at: expected,
  };

  await fetch(`${pbUrl}/api/collections/subscriptions/records/${sub.id}`, {
    method: "PATCH",
    headers: { Authorization: adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      image_credits_used: 0,
      video_credits_used: 0,
      credits_reset_at: expected,
    }),
  });

  return patched;
}

/**
 * Returns the current credit state for a user. Auto-resets the monthly counters
 * if a new calendar month has started.
 */
export async function getCreditState(
  pbUrl: string,
  userId: string
): Promise<CreditState> {
  const adminToken = await getAdminToken(pbUrl);
  let sub = await fetchSubscription(pbUrl, adminToken, userId);

  // Comp check — internal accounts get 100× Agency
  const comped = await isCompedUser(pbUrl, adminToken, userId);

  const planRaw = comped ? "agency" : (sub?.plan ?? "starter");
  const allowanceBase = PLAN_CREDITS[planRaw] ?? PLAN_CREDITS.starter!;
  const monthlyAllowance = comped
    ? { image: allowanceBase.image * COMP_MULTIPLIER, video: allowanceBase.video * COMP_MULTIPLIER }
    : allowanceBase;

  // Default state for users without a subscription record yet
  if (!sub) {
    return {
      plan: planRaw,
      monthlyAllowance,
      monthlyUsed: { image: 0, video: 0 },
      topupBalance: { image: 0, video: 0 },
      monthlyRemaining: { ...monthlyAllowance },
      totalRemaining: { ...monthlyAllowance },
      ceoAddonActive: false,
    };
  }

  // Reset monthly counters if we've crossed into a new month
  sub = await resetIfNewMonth(pbUrl, adminToken, sub);

  // W47 — lazy migration of legacy generic agent credits. Any residual
  // balance folds into image_credits_topup exactly once; second read finds
  // zero and skips. Keeps the §12 invariant (credits are image/video only)
  // without a bulk migration script.
  if ((sub.agent_credits_topup ?? 0) > 0) {
    const legacy = sub.agent_credits_topup ?? 0;
    const migratedImageTopup = (sub.image_credits_topup ?? 0) + legacy;
    await fetch(`${pbUrl}/api/collections/subscriptions/records/${sub.id}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ image_credits_topup: migratedImageTopup, agent_credits_topup: 0 }),
    });
    sub = { ...sub, image_credits_topup: migratedImageTopup, agent_credits_topup: 0 };
    console.log(`[W47-migration] user=${userId} migrated ${legacy} credits to image_credits_topup`);
  }

  const monthlyUsed = {
    image: sub.image_credits_used ?? 0,
    video: sub.video_credits_used ?? 0,
  };
  const topupBalance = {
    image: sub.image_credits_topup ?? 0,
    video: sub.video_credits_topup ?? 0,
  };
  const monthlyRemaining = {
    image: Math.max(0, monthlyAllowance.image - monthlyUsed.image),
    video: Math.max(0, monthlyAllowance.video - monthlyUsed.video),
  };
  const totalRemaining = {
    image: monthlyRemaining.image + topupBalance.image,
    video: monthlyRemaining.video + topupBalance.video,
  };

  return {
    plan: planRaw,
    monthlyAllowance,
    monthlyUsed,
    topupBalance,
    monthlyRemaining,
    totalRemaining,
    ceoAddonActive: !!sub.ceo_addon_sub,
  };
}

/**
 * Attempts to spend N credits of the given kind. Returns true on success,
 * false if the user has insufficient credits. Consumes monthly allowance
 * first, then top-up balance.
 */
export async function spendCredits(
  pbUrl: string,
  userId: string,
  kind: CreditKind,
  amount: number
): Promise<{ ok: boolean; remaining: number }> {
  if (amount <= 0) {
    const state = await getCreditState(pbUrl, userId);
    return { ok: true, remaining: state.totalRemaining[kind] };
  }

  const adminToken = await getAdminToken(pbUrl);
  let sub = await fetchSubscription(pbUrl, adminToken, userId);

  // No subscription record — create the bare minimum so we can track usage
  if (!sub) {
    const createRes = await fetch(`${pbUrl}/api/collections/subscriptions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        user: userId,
        plan: "starter",
        credits_reset_at: currentMonthIso(),
      }),
    });
    if (createRes.ok) sub = (await createRes.json()) as SubscriptionRecord;
  }
  if (!sub) return { ok: false, remaining: 0 };

  sub = await resetIfNewMonth(pbUrl, adminToken, sub);

  const state = await getCreditState(pbUrl, userId);
  if (state.totalRemaining[kind] < amount) {
    return { ok: false, remaining: state.totalRemaining[kind] };
  }

  // Spend monthly first, then top-up
  const fromMonthly = Math.min(state.monthlyRemaining[kind], amount);
  const fromTopup   = amount - fromMonthly;

  const newMonthlyUsed = (kind === "image" ? sub.image_credits_used : sub.video_credits_used) ?? 0;
  const newTopupBalance = (kind === "image" ? sub.image_credits_topup : sub.video_credits_topup) ?? 0;

  const patch: Record<string, number> = {};
  if (kind === "image") {
    patch.image_credits_used = newMonthlyUsed + fromMonthly;
    patch.image_credits_topup = Math.max(0, newTopupBalance - fromTopup);
  } else {
    patch.video_credits_used = newMonthlyUsed + fromMonthly;
    patch.video_credits_topup = Math.max(0, newTopupBalance - fromTopup);
  }

  await fetch(`${pbUrl}/api/collections/subscriptions/records/${sub.id}`, {
    method: "PATCH",
    headers: { Authorization: adminToken, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  return { ok: true, remaining: state.totalRemaining[kind] - amount };
}

/**
 * Add purchased top-up credits to a user's balance. Used by the Stripe
 * webhook after a top-up payment succeeds.
 *
 * W47 — creates the subscription record if missing so a user who buys
 * credits before settling a plan still gets credited (behavior ported from
 * the retired addAgentTopupCredits).
 */
export async function addTopupCredits(
  pbUrl: string,
  userId: string,
  kind: CreditKind,
  amount: number
): Promise<boolean> {
  if (amount <= 0) return true;
  const adminToken = await getAdminToken(pbUrl);
  const sub = await fetchSubscription(pbUrl, adminToken, userId);

  const field = kind === "image" ? "image_credits_topup" : "video_credits_topup";

  if (!sub) {
    const createRes = await fetch(`${pbUrl}/api/collections/subscriptions/records`, {
      method: "POST",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        user: userId,
        plan: "starter",
        [field]: amount,
        credits_reset_at: currentMonthIso(),
      }),
    });
    return createRes.ok;
  }

  const current = (kind === "image" ? sub.image_credits_topup : sub.video_credits_topup) ?? 0;
  const res = await fetch(`${pbUrl}/api/collections/subscriptions/records/${sub.id}`, {
    method: "PATCH",
    headers: { Authorization: adminToken, "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: current + amount }),
  });
  return res.ok;
}
