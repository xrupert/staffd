/**
 * W62 — The locked V1 action vocabulary (D-21 intelligence layer).
 *
 * Six platform actions, SA-locked. This is the WHAT-axis of post-generation
 * intelligence: which platform action applies to a finished artifact. The
 * WHO-axis (cross-department routing) is the handoff FollowUp — the two are
 * deliberately orthogonal (W62 ruling H1: `send_to_sales` was cut because
 * department routing belongs to FollowUps).
 *
 * Adding an action post-V1 requires explicit Senior Architect authorization
 * — same pattern as the ARCH §5 hard rule. A test pins the vocabulary size.
 */

export type ActionId =
  | "generate_image"
  | "generate_video"
  | "publish_social"     // data-only in V1 — publish handler is 410; W64 decides revive (ruling H3)
  | "schedule_followup"
  | "draft_email"
  | "export_document"
  // FC-2 — integration platform actions (SA-authorized 2026-06-15). Each maps
  // to a connected write route: Twenty / Listmonk / Chatwoot / Docuseal.
  | "send_to_crm"
  | "send_email_campaign";

export type ActionCandidate = {
  id: ActionId;
  /** Classifier's honest 0–1 applicability estimate. */
  confidence: number;
  /** Why the classifier suggested this — the transparency substrate (Decision 6). */
  reason: string;
  /** Optional action-specific hints (e.g. { platform: "instagram" }). */
  params?: Record<string, string>;
};

/** One-line definitions — fed verbatim to the classifier prompt. */
export const ACTION_VOCABULARY: ReadonlyArray<{ id: ActionId; definition: string }> = [
  { id: "generate_image",    definition: "The work would benefit from a visual companion image (ad copy, social post, menu, announcement)." },
  { id: "generate_video",    definition: "The work is shaped for short-form video (hooks, scripts, platform-tagged video copy)." },
  { id: "publish_social",    definition: "The work is platform-shaped social content ready to be published (hashtags, platform tags, caption format)." },
  { id: "schedule_followup", definition: "The work implies a time-based next touch (campaign sequence, renewal, post timing, reminder)." },
  { id: "draft_email",       definition: "The work should be announced or distributed by email (launch, newsletter-worthy content, customer notice)." },
  { id: "export_document",   definition: "The work is a formal document the user will share outside STAFFD (contract, proposal, report, plan)." },
  { id: "send_to_crm",       definition: "The work identifies a lead, prospect, or deal worth tracking in the CRM (qualified opportunity, outreach target, new account)." },
  { id: "send_email_campaign", definition: "The work is email content ready to be sent as a campaign to a subscriber list (newsletter, launch announcement, broadcast)." },
];

/** Ship-default surfacing gate (W62 Decision 3). Per-action calibration is post-V1 W62.1. */
export const CONFIDENCE_THRESHOLD = 0.6;

/**
 * W63 — UI metadata, SA-locked labels (W63 Decision 4). Single source of
 * truth: the affordance component imports from here; a test pins the set.
 * `hidden` actions persist as data but never render (W63 Decision 8 —
 * publish_social stays invisible until W64 decides the handler revive).
 */
export const ACTION_UI: Readonly<Record<ActionId, { label: string; icon: string; hidden?: boolean }>> = {
  generate_image:    { label: "Generate the visual →",   icon: "🖼️" },
  generate_video:    { label: "Generate the video →",    icon: "🎬" },
  publish_social:    { label: "Publish to social →",     icon: "📣", hidden: true },
  schedule_followup: { label: "Schedule a follow-up →",  icon: "🗓️" },
  draft_email:       { label: "Draft the email →",       icon: "✉️" },
  export_document:   { label: "Export as document →",    icon: "📄" },
  send_to_crm:         { label: "Add to CRM →",            icon: "📇" },
  send_email_campaign: { label: "Send as campaign →",      icon: "📧" },
};

const VALID_IDS = new Set<string>(ACTION_VOCABULARY.map((a) => a.id));

/**
 * Server-side validation gate: drops non-vocabulary ids, clamps confidence,
 * drops below-threshold candidates, coerces shapes defensively. The
 * classifier's raw output never reaches persistence unvalidated.
 */
export function validateCandidates(raw: unknown): ActionCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || !VALID_IDS.has(c.id)) continue;
    const confidence = typeof c.confidence === "number" ? Math.min(1, Math.max(0, c.confidence)) : 0;
    if (confidence < CONFIDENCE_THRESHOLD) continue;
    const reason = typeof c.reason === "string" ? c.reason.slice(0, 300) : "";
    if (!reason) continue;
    const candidate: ActionCandidate = { id: c.id as ActionId, confidence, reason };
    if (c.params && typeof c.params === "object" && !Array.isArray(c.params)) {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.params as Record<string, unknown>)) {
        if (typeof v === "string") params[k] = v.slice(0, 120);
      }
      if (Object.keys(params).length > 0) candidate.params = params;
    }
    out.push(candidate);
  }
  return out;
}
