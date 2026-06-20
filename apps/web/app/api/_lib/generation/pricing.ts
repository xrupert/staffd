/**
 * Generation tier pricing (W95.7.3d-T1) — PURE, no side effects, client-safe
 * (no node builtins / no pb), so both the server (catalog sync, muapi route)
 * and the client (GenerationTierModal) import it.
 *
 * THREE customer-facing tiers, operator-LOCKED. Credit weight is determined by
 * TIER, and a model's tier is determined by its underlying Muapi USD cost via
 * the locked bands below.
 *
 *   VIDEO:  quick 4cr ($0.06–0.15) · pro 8cr ($0.15–0.40) · premium 60cr ($2.40–3.00)
 *   IMAGE:  quick 1cr ($0.01–0.03) · pro 2cr ($0.03–0.08) · premium 4cr  ($0.10–0.30)
 *
 * Band-gap rule (W95.7.3d C3): a cost in an unmapped gap (video $0.40–2.40,
 * image $0.08–0.10) ROUNDS UP to the next higher tier — margin-protective. The
 * routing table only ever selects in-band models, so customers never see a
 * gap-priced surprise; the round-up is the safety net for catalog classification.
 */

export type GenKind = "image" | "video";
export type Tier = "quick" | "pro" | "premium";

export const TIERS: readonly Tier[] = ["quick", "pro", "premium"] as const;

/** Locked credit weight per (kind, tier). */
export const TIER_WEIGHT: Record<GenKind, Record<Tier, number>> = {
  video: { quick: 4, pro: 8, premium: 60 },
  image: { quick: 1, pro: 2, premium: 4 },
};

/** Customer-facing tier labels + one-line descriptions (ZERO vendor names). */
export const TIER_LABEL: Record<Tier, string> = { quick: "Quick", pro: "Pro", premium: "Premium" };
export const TIER_DESC: Record<GenKind, Record<Tier, string>> = {
  video: {
    quick: "Fast, sharp, prompt-crafted — great for previews and social drafts.",
    pro: "Higher fidelity and motion — your everyday publish quality.",
    premium: "Cinematic, top-of-the-line — for launches and hero moments.",
  },
  image: {
    quick: "Clean, on-brand visuals — fast and economical.",
    pro: "Richer detail and editing — your everyday publish quality.",
    premium: "Flagship quality — upscaled, character-consistent, hero-grade.",
  },
};

/**
 * Default tier per department (V1 = department-level; per-intent refinement is
 * W95.7.3d.1). "pro" is the balanced middle; the customer overrides in the
 * picker. A department absent here falls back to "pro".
 */
export const DEFAULT_TIER: Record<string, Partial<Record<GenKind, Tier>>> = {
  marketing: { video: "pro", image: "pro" },
  reputation: { video: "pro", image: "pro" },
  sales: { video: "pro", image: "pro" },
  operations: { video: "quick", image: "quick" },
  hr: { video: "quick", image: "quick" },
  finance: { video: "quick", image: "quick" },
  legal: { video: "quick", image: "quick" },
  it: { video: "quick", image: "quick" },
  ceo: { video: "premium", image: "pro" },
};

export function defaultTierFor(department: string, kind: GenKind): Tier {
  return DEFAULT_TIER[department]?.[kind] ?? "pro";
}

/** Classify a Muapi USD cost into a tier. Gap costs round UP (C3). */
export function computeTier(costUsd: number, kind: GenKind): Tier {
  if (kind === "video") {
    if (costUsd <= 0.15) return "quick";
    if (costUsd <= 0.40) return "pro";
    return "premium"; // $0.40–2.40 gap + premium band + above → premium (round-up)
  }
  if (costUsd <= 0.03) return "quick";
  if (costUsd <= 0.08) return "pro";
  return "premium"; // $0.08–0.10 gap + premium band + above → premium (round-up)
}

/** Locked credit weight for a model of the given USD cost + kind. */
export function computeCreditWeight(costUsd: number, kind: GenKind): number {
  return TIER_WEIGHT[kind][computeTier(costUsd, kind)];
}

/** Locked credit weight for a customer-selected tier. */
export function tierWeight(kind: GenKind, tier: Tier): number {
  return TIER_WEIGHT[kind][tier];
}
