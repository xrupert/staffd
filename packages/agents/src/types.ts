export type Department =
  | "marketing"
  | "sales"
  | "legal"
  | "hr"
  | "finance"
  | "operations"
  | "design"
  | "paid-media"
  | "ceo";

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
