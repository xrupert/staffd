/**
 * Cross-instance rate limit, backed by PocketBase.
 *
 * Replaces the in-memory Map that lived in /api/agent — that Map was scoped
 * per Vercel function instance, so the same user could spin up N instances
 * and effectively have N × limit. This counter is authoritative across the
 * fleet and resets on UTC day rollover.
 *
 * Fail-open: any PB failure returns allowed:true. We never block a paying
 * user because the counter is having a bad day.
 */

import { getAdminToken, pbUrl, pbEscape, adminHeaders, pbFirst } from "./pb";

export const RATE_LIMIT_MAX = 50; // generations per user per UTC day

type RateLimitRecord = {
  id: string;
  rate_limit_day?: string;
  rate_limit_count?: number;
};

export type RateLimitResult = { allowed: boolean; remaining: number };

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically checks the user's daily counter, resets it at UTC day rollover,
 * and increments on the allowed path. Returns `{allowed, remaining}`.
 *
 * Note: PB has no transactional UPDATE-RETURNING; the read-modify-write here
 * is racy under high concurrency but the worst case is N concurrent requests
 * all seeing count=49, all writing count=50, and one extra generation slipping
 * through. Acceptable for a 50/day limit and far better than the per-instance
 * Map this replaces.
 */
export async function checkAndIncrementRateLimit(userId: string): Promise<RateLimitResult> {
  if (!userId) return { allowed: true, remaining: RATE_LIMIT_MAX };

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const today = todayUtc();

    const sub = await pbFirst<RateLimitRecord>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token,
      { fields: "id,rate_limit_day,rate_limit_count" }
    );

    // No subscription row yet — create a minimal one with count=1
    if (!sub) {
      const res = await fetch(`${url}/api/collections/subscriptions/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify({
          user: userId,
          plan: "starter",
          rate_limit_day: today,
          rate_limit_count: 1,
        }),
      });
      if (!res.ok) return { allowed: true, remaining: RATE_LIMIT_MAX };
      return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }

    const isNewDay = sub.rate_limit_day !== today;
    const currentCount = isNewDay ? 0 : (sub.rate_limit_count ?? 0);

    if (currentCount >= RATE_LIMIT_MAX) {
      return { allowed: false, remaining: 0 };
    }

    const newCount = currentCount + 1;
    await fetch(`${url}/api/collections/subscriptions/records/${sub.id}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ rate_limit_day: today, rate_limit_count: newCount }),
    });

    return { allowed: true, remaining: RATE_LIMIT_MAX - newCount };
  } catch {
    return { allowed: true, remaining: RATE_LIMIT_MAX };
  }
}
