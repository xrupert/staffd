/**
 * Tier-picker options (W95.7.3d-h2) — PURE, client-safe (imports only pricing).
 *
 * The SINGLE source of truth for the rows shown in the pre-generation tier
 * picker. Both surfaces render from this:
 *   - GenerationTierModal   (DepartmentRoom — overlay; room/form surface)
 *   - GenerationTierInline  (CommandCenter — inline in the conversation stream)
 *
 * Centralizing here (Standard #2) means the two surfaces can never drift on
 * tier order, locked credit weights, labels/descriptions, or which tier is the
 * department's recommended default. ZERO vendor names — tiers are universal.
 */

import { TIERS, TIER_LABEL, TIER_DESC, tierWeight, defaultTierFor, type GenKind, type Tier } from "./pricing";

export type TierOption = {
  tier: Tier;
  label: string;
  desc: string;
  weight: number;
  recommended: boolean;
};

export type TierOptions = {
  recommended: Tier;
  rows: TierOption[];
};

/** A queued generation awaiting tier confirmation — shared by both gate surfaces. */
export type GenerationRequest = { kind: GenKind; department: string; prompt: string };

/** Build the picker rows for a (department, kind), with the dept default flagged. */
export function buildTierOptions(department: string, kind: GenKind): TierOptions {
  const recommended = defaultTierFor(department, kind);
  const rows: TierOption[] = TIERS.map((t) => ({
    tier: t,
    label: TIER_LABEL[t],
    desc: TIER_DESC[kind][t],
    weight: tierWeight(kind, t),
    recommended: t === recommended,
  }));
  return { recommended, rows };
}
