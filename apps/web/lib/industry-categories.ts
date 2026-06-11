/**
 * W59 — Industry category vocabulary (single source, client-safe).
 *
 * Category ids are the 8 industry-pack ids plus "other". Labels are
 * SA-locked verbatim (W59 Phase A §B / Decision 7) — do not reword
 * without SA approval. They read as kinds of business an owner would
 * call themselves, per BRAND_VOICE.md.
 */

export type IndustryCategoryId =
  | "law" | "real-estate" | "restaurants" | "coaches"
  | "trades" | "salons" | "agencies" | "consultants" | "other";

export const INDUSTRY_CATEGORIES: ReadonlyArray<{ id: IndustryCategoryId; label: string }> = [
  { id: "law",         label: "Law Firm / Legal Practice" },
  { id: "real-estate", label: "Real Estate" },
  { id: "restaurants", label: "Restaurants & Food Service" },
  { id: "coaches",     label: "Coaching / Personal Training / Fitness" },
  { id: "trades",      label: "Trades & Home Services" },
  { id: "salons",      label: "Salons & Spas / Beauty" },
  { id: "agencies",    label: "Creative / Marketing Agency" },
  { id: "consultants", label: "Consulting / Advisory" },
  { id: "other",       label: "Other / None of the above" },
];

export function industryCategoryLabel(id: string | null | undefined): string | null {
  return INDUSTRY_CATEGORIES.find((c) => c.id === id)?.label ?? null;
}
