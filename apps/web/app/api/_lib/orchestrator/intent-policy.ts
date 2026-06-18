/**
 * Intent field specs + autopilot policy (W95.1 → W95.5).
 *
 * Split out of intent.ts so the constants can be imported WITHOUT pulling in
 * llm.ts (which constructs the Anthropic SDK at module scope — that trips the
 * browser-env guard in happy-dom unit tests, and bloats client bundles). This
 * module has zero heavy imports; intent.ts re-exports everything here.
 */

export type IntentType =
  | "create_contact"
  | "log_interaction"
  | "schedule_followup"
  | "add_to_email_list"
  | "create_task"
  | "capture_lead"
  | "update_contact"
  | "log_expense"
  | "draft_campaign"
  | "send_for_signature"
  | "disable_autopilot";

export type IntentResult = {
  type: IntentType;
  fields: Record<string, string>;
  confidence: number;
};

export const INTENT_CONFIDENCE_THRESHOLD = 0.7;
/** Two candidates this close at/above the floor → offer both (disambiguation). */
export const DISAMBIGUATION_DELTA = 0.15;

/**
 * W95.5 — autopilot graduation policy per intent.
 *  - trivial  (N=3): low-stakes, no undo toast
 *  - audited  (N=5): reversible writes, undo toast mandatory
 *  - never    (N=∞): always confirm (delegates + meta-controls)
 */
export type AutopilotPolicy = "trivial" | "audited" | "never";
export const AUTOPILOT_TIER_THRESHOLD: Record<AutopilotPolicy, number> = { trivial: 3, audited: 5, never: Infinity };

export type IntentSpec = { keys: string[]; required: string; autopilotPolicy: AutopilotPolicy; autopilotThresholdOverride?: number };

/** Allowed flat field keys per intent + required field + autopilot policy. */
export const INTENT_FIELDS: Record<IntentType, IntentSpec> = {
  create_contact:     { keys: ["name", "email", "phone", "context"], required: "name", autopilotPolicy: "audited" },
  log_interaction:    { keys: ["contact_name", "interaction_type", "notes", "occurred_at"], required: "contact_name", autopilotPolicy: "trivial" },
  schedule_followup:  { keys: ["contact_name", "due_date", "notes"], required: "contact_name", autopilotPolicy: "trivial" },
  add_to_email_list:  { keys: ["email", "name", "list_name"], required: "email", autopilotPolicy: "audited" },
  create_task:        { keys: ["title", "due_date", "notes"], required: "title", autopilotPolicy: "trivial" },
  capture_lead:       { keys: ["name", "email", "company", "phone", "interest_summary", "source"], required: "name", autopilotPolicy: "audited" },
  update_contact:     { keys: ["contact_identifier", "new_name", "new_email", "new_phone", "new_context"], required: "contact_identifier", autopilotPolicy: "audited" },
  log_expense:        { keys: ["amount", "currency", "category", "description", "occurred_at", "client_name"], required: "amount", autopilotPolicy: "audited" },
  draft_campaign:     { keys: ["subject_hint", "target_audience", "message_summary", "occasion"], required: "message_summary", autopilotPolicy: "never" },
  send_for_signature: { keys: ["document_identifier", "signer_name", "signer_email", "signer_contact", "notes"], required: "document_identifier", autopilotPolicy: "never" },
  disable_autopilot:  { keys: ["intent_type"], required: "intent_type", autopilotPolicy: "never" },
};

/** Resolve the graduation threshold for an intent (override > tier default). */
export function autopilotThreshold(type: IntentType): number {
  const spec = INTENT_FIELDS[type];
  return spec.autopilotThresholdOverride ?? AUTOPILOT_TIER_THRESHOLD[spec.autopilotPolicy];
}

/** Intents that delegate to a specialist (workflow) rather than write a row. */
export const DELEGATE_INTENTS = new Set<IntentType>(["draft_campaign", "send_for_signature"]);
