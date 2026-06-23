/**
 * Generation model routing (W95.7.3d-T1) — SERVER-ONLY. Maps a
 * (department, kind, tier) to an ordered list of preferred Muapi model slugs.
 * Vendor slugs live here and NEVER reach the client (brand voice): the client
 * sends a tier + its department; the server resolves the model.
 *
 * V1 is DEPARTMENT-LEVEL (Option A, ratified) — no per-intent ("tiktok-preview")
 * shape. Default tier per department comes from pricing.DEFAULT_TIER; per-intent
 * routing + tier-aware prompts are W95.7.3d.1.
 *
 * Most departments share DEFAULT_MODELS; a department only needs an entry in
 * ROUTING to override (marketing shown as the example shape). First slug = most
 * preferred; the caller falls to the next if absent from generation_models.
 *
 * Slugs are validated against the live Muapi catalog by validateRoutingSlugs
 * (called from the hourly sync); any slug not in the catalog throws, naming the
 * offender. Current slugs are catalog-pending verification (see
 * docs/operator-runbooks/muapi-vendor-drift.md §5).
 */

import { defaultTierFor, type GenKind, type Tier } from "./pricing";

type TierModels = Record<Tier, string[]>;

/** Best-of-band defaults per kind (shared across departments unless overridden). */
const DEFAULT_MODELS: Record<GenKind, TierModels> = {
  video: {
    quick: ["pixverse-v5.5-i2v", "seedance-pro-i2v-fast"],          // $0.06–0.15
    pro: ["pixverse-v6-i2v", "kling-v2.1-standard-i2v"],            // $0.15–0.40
    premium: ["veo3.1-image-to-video", "openai-sora-2-pro-image-to-video"], // $2.40–3.00
  },
  image: {
    quick: ["flux-schnell"],                                        // $0.01–0.03 (verified present in the live catalog 2026-06-23)
    pro: ["flux-dev", "nano-banana-edit"],                          // $0.03–0.08 ("flux-dev" is the REAL catalog slug; the h1 "flux-1-dev" never existed)
    premium: ["nano-banana-pro", "ideogram-character"],            // $0.10–0.30 (all verified present)
  },
};

/** Per-department overrides (optional). Marketing shown as the example shape. */
const ROUTING: Record<string, Partial<Record<GenKind, TierModels>>> = {
  marketing: {
    video: DEFAULT_MODELS.video,
    image: DEFAULT_MODELS.image,
  },
};

/** Ordered model preference for a (department, kind, tier). */
export function routeFor(department: string, kind: GenKind, tier: Tier): string[] {
  return ROUTING[department]?.[kind]?.[tier] ?? DEFAULT_MODELS[kind][tier];
}

/** Default tier for a department + kind (re-exported from pricing for callers). */
export function routeDefaultTier(department: string, kind: GenKind): Tier {
  return defaultTierFor(department, kind);
}

/** Every model slug referenced anywhere in routing (for catalog validation). */
export function allRoutingSlugs(): string[] {
  const slugs = new Set<string>();
  const add = (tm: TierModels) => { for (const t of ["quick", "pro", "premium"] as Tier[]) tm[t].forEach((s) => slugs.add(s)); };
  add(DEFAULT_MODELS.video); add(DEFAULT_MODELS.image);
  for (const dept of Object.values(ROUTING)) {
    if (dept.video) add(dept.video);
    if (dept.image) add(dept.image);
  }
  return [...slugs];
}

/**
 * Throws if any routing slug is absent from the live Muapi catalog (C5 — catches
 * model-slug drift at sync; the error names the offending slug(s)).
 */
export function validateRoutingSlugs(catalogNames: Set<string>): void {
  const missing = allRoutingSlugs().filter((s) => !catalogNames.has(s));
  if (missing.length > 0) {
    throw new Error(`[generation] routing slugs absent from Muapi catalog: ${missing.join(", ")}`);
  }
}
