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

/**
 * Per Decision 23 — Capability-first architecture. The foundation for any
 * agent-side feature: routes / handlers check `agent.capabilities?.includes(...)`
 * before injecting capability-specific context blocks. Capability declarations
 * land on specific agents in downstream PRs (Bundle 5 = OCR/vision; Bundle 9
 * V2 = reads_*; Bundle 7 deferred = voice/transcript/scheduling/urgency).
 *
 * Per Standard #7 (Audit-Before-Extend) — new capability values beyond this
 * enum require explicit Senior Architect approval.
 */
export type AgentCapability =
  | "ocr"                    // Image/PDF text extraction via Claude Vision
  | "vision"                 // Image content analysis
  | "structured_extraction"  // Schema-aware data extraction
  | "transcript_handling"    // Audio transcript processing (Bundle 7 future)
  | "voice"                  // Voice synthesis/recognition (Bundle 7 future)
  | "scheduling"             // Calendar event creation (Bundle 7 future)
  | "urgency_classification" // Priority assessment
  | "reads_crm"              // Twenty CRM READ access (Bundle 9 V2)
  | "reads_email_campaigns"  // Listmonk READ access (Bundle 9 V2)
  | "reads_support_history"  // Chatwoot READ access (Bundle 9 V2)
  | "reads_signatures"       // Docuseal READ access (Bundle 9 V2)
  | "reads_analytics";       // Plausible READ access (Bundle 9 V2 + Decision 47A)

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
  /**
   * Capability declarations (Decision 23 — capability-first architecture).
   * Foundation for all downstream agent-side features. See `AgentCapability`
   * for the locked enum + consumer mapping. Existing 138 agents leave this
   * undefined; declarations are added in downstream PRs.
   */
  capabilities?: AgentCapability[];
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
