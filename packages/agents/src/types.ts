export type Department =
  | "marketing"
  | "sales"
  | "legal"
  | "hr"
  | "finance"
  | "operations"
  | "design"
  | "paid-media"
  | "reputation"
  | "ceo";

/** Phase 8 — industry packs. Stable union; new packs require a code change. */
export type IndustryPack =
  | "law"
  | "real-estate"
  | "restaurants"
  | "coaches"
  | "trades"
  | "salons"
  | "agencies"
  | "consultants";

export interface AgentDef {
  /** Unique slug, e.g. "marketing-content-creator" */
  id: string;
  /** Display name shown in the roster UI */
  name: string;
  department: Department;
  /** One-line description for the roster card */
  description: string;
  /** Emoji icon for the card */
  emoji: string;
  /** Accent color (hex) for the card */
  color: string;
  /**
   * System prompt for this agent — pure instruction text.
   * Vault context is injected at call time via buildPrompt().
   */
  systemPrompt: string;
  /**
   * Tags that describe what this agent produces.
   * Used by the Command Center to route tasks automatically.
   */
  tags: string[];
  /**
   * Phase 8 — present when this agent belongs to an industry pack.
   * Generic (always-on) agents leave this undefined.
   */
  pack?: IndustryPack;
  /**
   * Phase 8 — explicit marker that THIS is the pack's canonical agent for
   * the given department. Used when a pack has multiple agents in the same
   * department and we need a deterministic default. Optional; resolution
   * falls back to the first pack agent in that dept when absent.
   */
  packDefault?: boolean;
}

export interface IndustryPackMeta {
  id: IndustryPack;
  name: string;
  /** Short marketing description shown in the Settings panel. */
  description: string;
  /** Single emoji glyph used in the UI card. */
  icon: string;
}

export interface VaultContext {
  business_name?: string;
  industry?: string;
  description?: string;
  target_audience?: string;
  website?: string;
  address?: string;
  phone?: string;
  primary_email?: string;
  secondary_email?: string;
  other_email?: string;
  focus?: string;
  situation?: string;
  superpower?: string;
  bottlenecks?: string[];
  magic_wand?: string;
}
