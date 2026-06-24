/**
 * Cinematic usage (W95.9.2) — SERVER-only (uses the admin token). Counts this
 * month's cinematic clips from generation_jobs and folds them, the plan
 * allowance, and any Cinema-pack top-ups into the single state the project-start
 * gate + the UI read.
 *
 * A cinematic clip is a kind=video, tier=premium job (the premium tier routes to
 * veo3/sora). Failed jobs don't count — no charge, no usage. The count uses PB's
 * `totalItems` so we never page the rows.
 *
 * NOTE for the tier-picker reframe (slice 4): cinematic jobs MUST keep being
 * tagged tier="premium" (or gain an explicit `cinematic` flag) for this count to
 * stay correct.
 */

import { pbUrl, getAdminToken, pbEscape } from "../pb";
import { cinematicGate, daysUntilMonthlyReset, monthStartISO, type CinematicGate } from "./cinematic-allowance";

export async function countCinematicThisMonth(userId: string, now: Date = new Date()): Promise<number> {
  if (!userId) return 0;
  const since = monthStartISO(now);
  const filter =
    `user = "${pbEscape(userId)}" && kind = "video" && tier = "premium" ` +
    `&& created >= "${since}" && status != "failed"`;
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/generation_jobs/records?filter=${encodeURIComponent(filter)}&perPage=1&fields=id`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalItems?: number };
    return data.totalItems ?? 0;
  } catch {
    return 0;
  }
}

export type CinematicState = CinematicGate & { resetsInDays: number };

export async function getCinematicState(
  userId: string,
  plan: string | null | undefined,
  packTopups = 0,
  now: Date = new Date(),
): Promise<CinematicState> {
  const used = await countCinematicThisMonth(userId, now);
  return { ...cinematicGate(plan, used, packTopups), resetsInDays: daysUntilMonthlyReset(now) };
}
