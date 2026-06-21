/**
 * Generation trigger-surface registry (W95.7.3d-h2) — the enforced invariant
 * behind Standard #38: every place that can start a paid generation MUST pass a
 * tier gate. Each entry pairs a UI surface that calls `runGeneration` with the
 * tier-gate component it routes through.
 *
 * This registry is the single declared set of trigger surfaces; the guard test
 * (`__tests__/generation/trigger-surfaces.test.ts`) fails CI if a `runGeneration`
 * call site appears anywhere under app/ or lib/ that is NOT listed here, or if a
 * listed file stops referencing its gate. Adding a new generation trigger (e.g.
 * the future L4 workflow planner) therefore forces a conscious register-and-gate
 * step — an ungated trigger can no longer slip in unnoticed.
 *
 * `file` is the path relative to apps/web. `gate` is the component the surface
 * must mount before any submit:
 *   - GenerationTierModal   — overlay picker (DepartmentRoom; room/form surface)
 *   - GenerationTierInline  — inline picker in the conversation stream (CommandCenter)
 */

export type TriggerSurface = {
  /** Stable id for the surface. */
  id: string;
  /** Path relative to apps/web of the file containing the runGeneration call. */
  file: string;
  /** Tier-gate component this surface must reference before submitting. */
  gate: "GenerationTierModal" | "GenerationTierInline";
};

export const GENERATION_TRIGGER_SURFACES: readonly TriggerSurface[] = [
  { id: "command-center", file: "app/components/CommandCenter.tsx", gate: "GenerationTierInline" },
  { id: "department-room", file: "app/components/DepartmentRoom.tsx", gate: "GenerationTierModal" },
];
