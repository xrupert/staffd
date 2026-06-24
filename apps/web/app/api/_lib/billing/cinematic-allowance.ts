/**
 * Cinematic allowance gate (W95.9.1) — PURE, client-safe.
 *
 * The one metered thing in the value-priced model is cinematic video. This
 * decides whether a NEW cinematic project may start, given the plan's monthly
 * allowance + any purchased Cinema-pack top-ups, against how many cinematic
 * clips the customer has already used this calendar month.
 *
 * Rule (SA-ratified, [[project_staffd_pricing_generation]]): gate ONLY at
 * project start — a project already in flight always finishes (so over-use can
 * push `used` past the cap; remaining never goes negative). Resets monthly.
 * The counting (query generation_jobs for the month) lives in the wiring slice;
 * this module is the pure decision so it's trivially testable.
 */

import { cinematicAllowance } from "./plan-benefits";

export type CinematicGate = {
  allowed: boolean;
  used: number;
  /** Plan allowance + pack top-ups. */
  allowance: number;
  remaining: number;
};

export function cinematicGate(
  plan: string | null | undefined,
  used: number,
  packTopups = 0,
): CinematicGate {
  const allowance = cinematicAllowance(plan) + Math.max(0, packTopups);
  const remaining = Math.max(0, allowance - Math.max(0, used));
  return { allowed: remaining > 0, used: Math.max(0, used), allowance, remaining };
}

/** Whole days until the allowance resets (the 1st of next month, UTC). */
export function daysUntilMonthlyReset(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.ceil((next - now.getTime()) / 86_400_000);
}

/** UTC start-of-month ISO — the lower bound for counting this month's usage. */
export function monthStartISO(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
