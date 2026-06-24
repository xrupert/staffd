/**
 * Plan benefits (W95.9) — the single typed source of truth for the value-priced,
 * meter-buried model. PURE + client-safe (the UpgradeModal, the project-start
 * allowance gate, and the upsell all import it).
 *
 * Principle (see [[project_staffd_pricing_generation]]): price on the WORK, not
 * compute. Everyday generation (fast image ~$0.015, fast video ~$0.60) is
 * unlimited fair-use on every paid plan — rationing pennies is pure friction.
 * The ONLY metered thing is CINEMATIC video (full Veo 3 / Sora ~$2.50), and even
 * that is a monthly *allowance* (resets), never a per-click credit decision, and
 * only ever gated at the START of a new project — never mid-render.
 */

export type PlanId = "starter" | "growth" | "pro" | "agency";

/**
 * A cinematic "video" is assembled from ~8 generated shots (one ~4s clip each),
 * and STAFFD stitches them into the finished commercial. The allowance is
 * counted in CLIPS (each shot = one generation against the budget) but is
 * communicated to the customer in finished pieces: e.g. 24 clips ≈ 3 thirty-
 * second commercials.
 */
export const CLIPS_PER_COMMERCIAL = 8;

export type PlanBenefit = {
  label: string;
  /**
   * Everyday (fast, ~$0.60) video clips per month — an INVISIBLE fair-use
   * ceiling: generous enough that normal use never sees it (meter stays
   * buried), but bounded so a power user can't run cost away. Images are
   * unlimited (cost ~$0.015 — not worth metering).
   */
  everydayVideoPerMonth: number;
  /**
   * Cinematic (premium, ~$2.50) clips per month — the one VISIBLE allowance.
   * 0 → upsell on reach. Gated only at the start of a new project, never
   * mid-render; resets monthly; Cinema packs top it up.
   */
  cinematicPerMonth: number;
};

// Allowances designed on AVERAGE usage (~25-30% of ceiling → ~80% gross
// margin); the rare ceiling-hitter is the best upgrade/pack candidate.
export const PLAN_BENEFITS: Record<PlanId, PlanBenefit> = {
  starter: { label: "Starter", everydayVideoPerMonth: 25,  cinematicPerMonth: 0 },
  growth:  { label: "Growth",  everydayVideoPerMonth: 50,  cinematicPerMonth: 8 },  // ≈1 commercial
  pro:     { label: "Pro",     everydayVideoPerMonth: 100, cinematicPerMonth: 24 }, // ≈3 commercials
  agency:  { label: "Agency",  everydayVideoPerMonth: 250, cinematicPerMonth: 60 }, // ≈7 commercials
};

/** Cinematic allowance expressed as finished ~30s commercials (for UI copy). */
export function commercialsFromClips(clips: number): number {
  return Math.floor(clips / CLIPS_PER_COMMERCIAL);
}

/** Monthly cinematic allowance for a plan id. Unknown/unset → 0 (safe → upsell). */
export function cinematicAllowance(plan: string | null | undefined): number {
  if (!plan) return 0;
  return PLAN_BENEFITS[plan as PlanId]?.cinematicPerMonth ?? 0;
}

/** Whether a plan includes any cinematic at all (drives include-vs-upsell copy). */
export function planIncludesCinematic(plan: string | null | undefined): boolean {
  return cinematicAllowance(plan) > 0;
}

/**
 * Cinema extension packs — one-time top-ups offered ONLY when a Pro/Agency
 * customer exhausts their monthly cinematic allowance (replaces the incoherent
 * "video credit" packs). Priced above model cost (~$2.50/clip) for margin.
 */
export type CinemaPack = { id: string; cinematic: number; priceCents: number };

export const CINEMA_PACKS: readonly CinemaPack[] = [
  { id: "cinema-10", cinematic: 10, priceCents: 3900 }, // $39 — $3.90/clip
  { id: "cinema-30", cinematic: 30, priceCents: 9900 }, // $99 — $3.30/clip (volume)
] as const;
