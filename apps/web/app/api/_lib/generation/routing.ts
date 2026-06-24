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
  // TEXT-TO-VIDEO only (W95.7.3d-h4, verified 2026-06-23): customers describe a
  // video in words, so we MUST route to t2v models (prompt-only). The earlier
  // i2v ("image-to-video") slugs REQUIRED a source image (image_url/images_list)
  // that the conversational flow never provides → every video submit 400'd.
  //
  // W95.7.3e-vid2 (verified 2026-06-24 against the OpenAPI; costs from the live
  // muapi usage dashboard): pixverse was BOTH worse AND no cheaper —
  // pixverse-v6-t2v billed $0.585 for an incoherent clip while veo3-fast bills
  // $0.60 for genuinely usable output. So the everyday tier is now Google Veo 3
  // Fast; cinematic is full Veo 3 / Sora 2 (~$2.50). All slugs have a real
  // POST /api/v1/<slug> with required=["prompt"]. Models are a swappable
  // registry — update these picks as the leaderboard turns, no code change.
  video: {
    quick: ["seedance-2-text-to-video", "veo3-fast-text-to-video"], // cheap, clean
    pro: ["veo3-fast-text-to-video", "seedance-2-text-to-video"],   // ~$0.60, proven good
    premium: ["veo3-text-to-video", "openai-sora-2-pro-text-to-video"], // ~$2.50, cinematic
  },
  // TEXT-TO-IMAGE only, every slug verified 2026-06-23 to have a real
  // POST /api/v1/<slug> path + required=["prompt"]. NOTE: flux-schnell / flux-dev
  // have NO /api/v1/<slug> submit path (they 404 live) — the flux-2 family does.
  image: {
    quick: ["flux-2-dev", "flux-2-klein-9b"],                       // $0.01–0.02
    pro: ["flux-2-pro", "google-imagen4"],                          // $0.03–0.04
    premium: ["nano-banana-pro", "midjourney-v8"],                  // $0.10–0.12
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
