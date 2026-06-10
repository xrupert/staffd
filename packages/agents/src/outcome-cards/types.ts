/**
 * W44 — Outcome cards: the canonical pool of operator-language task cards.
 *
 * Single source of truth for four downstream surfaces: department empty
 * states (W43), pricing page reframe (W45), landing page rewrite, and the
 * demo page. Copy here is brand-locked per BRAND_VOICE.md and Decision 12
 * ("Voice is non-negotiable") — validated by
 * `src/__tests__/outcome-cards.test.ts`.
 */

export type OutcomeCardDepartment =
  | "marketing" | "sales" | "legal" | "hr" | "finance"
  | "operations" | "paid-media" | "design" | "reputation" | "ceo";

export type OutcomeCardTag =
  // Cadence
  | "weekly" | "monthly" | "quarterly" | "one-shot" | "ongoing"
  // Audience / business shape
  | "b2b" | "b2c" | "ecommerce" | "service" | "agency"
  // Industry-leaning (matches industry packs)
  | "law" | "real-estate" | "restaurants" | "coaches"
  | "trades" | "salons" | "consultants"
  // Output type
  | "content" | "ops" | "growth" | "revenue" | "compliance"
  | "people" | "money" | "creative" | "support";

export interface OutcomeCard {
  /** Stable unique id across the entire pool. Format:
   *  {dept-short}-{verb}-{noun}. Examples: mkt-write-blog,
   *  sal-draft-coldemail, hr-build-onboarding. */
  id: string;
  /** Department this card belongs to. */
  department: OutcomeCardDepartment;
  /** Card label shown to user. Verb-first. Operator language.
   *  No specialist names. Max 50 chars. Examples:
   *    "Write this week's blog post"
   *    "Draft cold outreach to a new prospect"
   *    "Build a 30/60/90 onboarding plan"
   */
  label: string;
  /** The exact text that pre-fills the chat input when the card
   *  is clicked. 1–2 sentences. Pulls implicit vault context. */
  seed: string;
  /** Tags drawn ONLY from OutcomeCardTag union. No free-form. */
  tags: OutcomeCardTag[];
  /** Default surfacing weight. 1.0 = standard. 0.5 = niche.
   *  1.5 = high-value evergreen. Used by W43.1 rotation. */
  weight: number;
}
