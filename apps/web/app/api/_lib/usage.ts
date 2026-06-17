/**
 * W92 — Super-Admin Usage Dashboard: pure fleet-metric helpers.
 *
 * Kept pure + exported so the aggregator route stays a thin PB-fetch shell
 * and the metric logic is runtime-testable without HTTP/PB. No new logging,
 * no new collections (Standard #20) — these only shape data already in PB.
 */

import { isCompedEmail } from "./comp";

export type UserType = "super-admin" | "comp" | "customer";

/**
 * Classify a fleet user. The operator (ADMIN_EMAIL) is also in the comp set
 * by design (dogfooding) — so super-admin MUST win before the comp check.
 */
export function classifyUser(email: string | null | undefined, adminEmail: string): UserType {
  const e = (email ?? "").trim().toLowerCase();
  const admin = (adminEmail ?? "").trim().toLowerCase();
  if (e && admin && e === admin) return "super-admin";
  if (isCompedEmail(email)) return "comp";
  return "customer";
}

/** Most-recent ISO date across activity sources (the last-activity proxy). */
export function lastActivityProxy(dates: (string | null | undefined)[]): string | null {
  let max: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (max === null || d > max) max = d;
  }
  return max;
}

export type ActivityBucket = "active7" | "active30" | "dormant" | "never";

/** Bucket a user by recency of their last activity. */
export function activityBucket(last: string | null | undefined, now: Date): ActivityBucket {
  if (!last) return "never";
  const ageDays = (now.getTime() - new Date(last).getTime()) / 86_400_000;
  if (ageDays <= 7) return "active7";
  if (ageDays <= 30) return "active30";
  return "dormant";
}

export type ChurnState = "expired" | "expiring" | "ok" | "none";

/** Churn signal from a subscription's active_until (expiring window = 14d). */
export function churnState(activeUntil: string | null | undefined, now: Date): ChurnState {
  if (!activeUntil) return "none";
  const end = new Date(activeUntil).getTime();
  const ms = end - now.getTime();
  if (ms < 0) return "expired";
  if (ms <= 14 * 86_400_000) return "expiring";
  return "ok";
}

/** Rounded success percentage; 0 when there are no tasks (no divide-by-zero). */
export function taskSuccessRate(succeeded: number, total: number): number {
  if (!total) return 0;
  return Math.round((succeeded / total) * 100);
}

/**
 * Operator-row marking — the dashboard analog of the Plausible opt-out.
 * Operator + comp rows get a visible badge so their dogfood activity stays
 * separable from customer signal. Customers get no badge. (We mark, never
 * filter.)
 */
export function usageBadge(type: UserType): { label: string; color: string } | null {
  if (type === "super-admin") return { label: "Operator", color: "#5B21E8" };
  if (type === "comp") return { label: "Comp", color: "#F59E0B" };
  return null;
}
