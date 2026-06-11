/**
 * Trial / department-resolution helpers.
 *
 * Lifts the logic previously hidden behind `fetch('/api/trial')` self-calls
 * into a direct library so orchestrator / agent / Command Center routes can
 * read subscription state without an extra HTTP hop.
 *
 * The HTTP endpoint at /api/trial still exists for client-side callers
 * (onboarding, gating components in the dashboard) — it now delegates here.
 */

import { isCompedUser } from "./comp";
import { PACK_IDS, resolveIndustryToPackId } from "@staffd/agents";
import { getAdminToken, pbUrl, pbEscape, adminHeaders, pbFirst } from "./pb";

const TRIAL_LIMIT = 3;

const STARTER_DEPARTMENTS = new Set(["marketing", "sales", "legal"]);

const PLAN_AUTO: Record<string, string[]> = {
  starter: [],
  growth:  [],
  pro:     ["ceo"],
  agency:  ["hr", "finance", "operations", "ceo", "paid-media", "design"],
};

type SubscriptionRecord = {
  id: string;
  plan?: string;
  trial_runs?: Record<string, number> | null;
  unlocked_departments?: string[] | null;
  ceo_addon_sub?: string | null;  // Phase 4 — CEO add-on subscription id
  industry_packs?: string[] | null; // Phase 8 — active pack ids
};

/** Returns the full set of unlocked departments for a (plan, choices, addons) tuple. */
function resolveUnlocked(
  plan: string,
  unlockedDepts: string[] | null,
  ceoAddonSub: string | null
): Set<string> {
  const base = new Set(STARTER_DEPARTMENTS);
  for (const d of (PLAN_AUTO[plan] ?? [])) base.add(d);

  // Phase 4 — CEO add-on unlocks the CEO dept on Starter/Growth without
  // changing the user's plan. No-op when plan already includes CEO
  // (Pro + Agency + comped users).
  if (ceoAddonSub) base.add("ceo");

  if (plan === "agency") {
    base.add("hr"); base.add("finance"); base.add("operations");
    base.add("paid-media"); base.add("design"); base.add("reputation");
    return base;
  }

  if (unlockedDepts && unlockedDepts.length > 0) {
    for (const d of unlockedDepts) base.add(d);
  } else {
    const legacy: Record<string, string[]> = {
      growth: ["hr"],
      pro:    ["hr", "finance", "operations"],
    };
    for (const d of (legacy[plan] ?? [])) base.add(d);
  }
  return base;
}

export type TrialState = {
  plan: string;
  resolved: string[];
  unlockedDepartments: string[];
  trialRuns: Record<string, number>;
  needsDepartmentSelection: boolean;
  subId: string | null;
  comp: boolean;
  /** Phase 8 — active industry-pack ids on this user's account. */
  activePacks: string[];
};

/**
 * Resolves the full department + trial picture for a user. No self-fetch.
 *
 * W58.0.1 (D-19 bridging) — `opts.vaultIndustry` is the user's free-text
 * business industry. When the subscription carries no explicit pack
 * ownership and the user is non-comp, the industry resolves to a pack id
 * and auto-activates that single pack. Callers without vault access omit
 * it and keep pre-bridging behavior (W58.2 adds vault loading to them).
 */
export async function resolveDepartments(
  userId: string,
  opts?: { vaultIndustry?: string | null }
): Promise<TrialState> {
  const fallback: TrialState = {
    plan: "starter",
    resolved: [...STARTER_DEPARTMENTS],
    unlockedDepartments: [],
    trialRuns: {},
    needsDepartmentSelection: false,
    subId: null,
    comp: false,
    activePacks: [],
  };
  if (!userId) return fallback;

  try {
    const token = await getAdminToken();
    const sub = await pbFirst<SubscriptionRecord>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token
    );

    const comped = await isCompedUser(pbUrl(), token, userId);
    const plan = comped ? "agency" : (sub?.plan ?? "starter");
    const unlockedDepts = sub?.unlocked_departments ?? null;
    const resolved = resolveUnlocked(plan, unlockedDepts, sub?.ceo_addon_sub ?? null);

    // Hotfix E1 — comped accounts (jrw-solutions.com et al.) get EVERY
    // industry pack auto-activated. This matches the comp = "full agency
    // with everything turned on" intent and was the gap behind the user's
    // "less than 100 agents active" observation: 83 core + 55 packed = 138
    // specialists, but pack agents only surface when the pack is active.
    const subscribedPacks = Array.isArray(sub?.industry_packs) ? sub.industry_packs : [];
    // W58.0.1 (D-19) — pack activation, in priority order:
    //   1. Comp → every pack (unchanged Hotfix E1 behavior).
    //   2. Explicit subscription ownership → honor it (backward compat
    //      for purchased-pack data).
    //   3. Industry bridging → the user's business industry resolves to
    //      a pack id and auto-activates that single pack. No match (or
    //      no vaultIndustry supplied) → no packs, pre-bridging behavior.
    let activePacks: string[];
    if (comped) {
      activePacks = [...PACK_IDS];
    } else if (subscribedPacks.length > 0) {
      activePacks = subscribedPacks;
    } else {
      const bridged = resolveIndustryToPackId(opts?.vaultIndustry);
      activePacks = bridged ? [bridged] : [];
    }

    return {
      plan,
      resolved: [...resolved],
      unlockedDepartments: unlockedDepts ?? [],
      trialRuns: sub?.trial_runs ?? {},
      needsDepartmentSelection:
        (plan === "growth" || plan === "pro") &&
        (!unlockedDepts || unlockedDepts.length === 0),
      subId: sub?.id ?? null,
      comp: comped,
      activePacks,
    };
  } catch {
    return fallback;
  }
}

export type TrialRunResult =
  | { allowed: true;  plan: string; trialRuns: Record<string, number>; remaining: number | null }
  | { allowed: false; plan: string; trialRuns: Record<string, number>; reason: "trial_exhausted" };

/**
 * Record a trial run for a department. Returns `allowed:false` when the user
 * has consumed their 3 free runs against a locked department.
 *
 * Fail-open: any PB failure returns allowed:true (don't block users on
 * tracking errors).
 */
export async function recordTrialRun(
  userId: string,
  department: string
): Promise<TrialRunResult> {
  if (!userId || !department) {
    return { allowed: true, plan: "starter", trialRuns: {}, remaining: null };
  }

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const headers = adminHeaders(token);

    const sub = await pbFirst<SubscriptionRecord>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token
    );

    const comped = await isCompedUser(url, token, userId);
    const plan = comped ? "agency" : (sub?.plan ?? "starter");
    const planDepts = resolveUnlocked(plan, sub?.unlocked_departments ?? null, sub?.ceo_addon_sub ?? null);

    if (planDepts.has(department)) {
      return { allowed: true, plan, trialRuns: sub?.trial_runs ?? {}, remaining: null };
    }

    const trialRuns = { ...(sub?.trial_runs ?? {}) };
    const current = trialRuns[department] ?? 0;

    if (current >= TRIAL_LIMIT) {
      return { allowed: false, plan, trialRuns, reason: "trial_exhausted" };
    }

    trialRuns[department] = current + 1;
    const remaining = TRIAL_LIMIT - trialRuns[department];

    if (sub?.id) {
      await fetch(`${url}/api/collections/subscriptions/records/${sub.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ trial_runs: trialRuns }),
      });
    } else {
      await fetch(`${url}/api/collections/subscriptions/records`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user: userId, plan: "starter", trial_runs: trialRuns }),
      });
    }

    return { allowed: true, plan, trialRuns, remaining };
  } catch {
    // Fail-open
    return { allowed: true, plan: "starter", trialRuns: {}, remaining: null };
  }
}
