/**
 * Conversational intent extraction (Model B3) — W95.1 / W95.4a / W95.4b.
 *
 * Sibling to analyzer.ts: reads a RAW user message → intent + structured fields
 * (pre-hoc) so STAFFD can render a confirmation preview before committing.
 * Reuses callLLM (no new Anthropic call site — W61′ allowlist preserved).
 *
 * W95.4b: extractIntent now returns IntentResult[] (top-2 disambiguation). The
 * LLM returns ranked candidates; we surface two only when both clear the floor
 * AND are within DISAMBIGUATION_DELTA of each other (genuinely ambiguous, e.g.
 * "John at Acme wants consulting, add him" = capture_lead vs create_contact).
 * 10 V1 intents: 7 confirm-to-commit (W95.4a) + create_contact + 2 delegate.
 */

import { callLLM } from "./llm";

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
  | "send_for_signature";

export type IntentResult = {
  type: IntentType;
  fields: Record<string, string>;
  confidence: number;
};

export const INTENT_CONFIDENCE_THRESHOLD = 0.7;
/** Two candidates this close at/above the floor → offer both (disambiguation). */
export const DISAMBIGUATION_DELTA = 0.15;

/** Allowed flat field keys per intent + the one that MUST be present. */
export const INTENT_FIELDS: Record<IntentType, { keys: string[]; required: string }> = {
  create_contact:     { keys: ["name", "email", "phone", "context"], required: "name" },
  log_interaction:    { keys: ["contact_name", "interaction_type", "notes", "occurred_at"], required: "contact_name" },
  schedule_followup:  { keys: ["contact_name", "due_date", "notes"], required: "contact_name" },
  add_to_email_list:  { keys: ["email", "name", "list_name"], required: "email" },
  create_task:        { keys: ["title", "due_date", "notes"], required: "title" },
  capture_lead:       { keys: ["name", "email", "company", "phone", "interest_summary", "source"], required: "name" },
  update_contact:     { keys: ["contact_identifier", "new_name", "new_email", "new_phone", "new_context"], required: "contact_identifier" },
  log_expense:        { keys: ["amount", "currency", "category", "description", "occurred_at", "client_name"], required: "amount" },
  draft_campaign:     { keys: ["subject_hint", "target_audience", "message_summary", "occasion"], required: "message_summary" },
  send_for_signature: { keys: ["document_identifier", "signer_name", "signer_email", "signer_contact", "notes"], required: "document_identifier" },
};

/** Intents that delegate to a specialist (workflow) rather than write a row. */
export const DELEGATE_INTENTS = new Set<IntentType>(["draft_campaign", "send_for_signature"]);

const KNOWN = new Set(Object.keys(INTENT_FIELDS));

const SYSTEM = `You extract actionable INTENT(s) from a small-business owner's message. Return STRICT JSON, no prose.

Intent types and their fields (use these exact field keys; omit keys you can't fill):
- create_contact — add/remember a person. fields: name(req), email, phone, context
- log_interaction — they just talked to someone. fields: contact_name(req), interaction_type(call|email|meeting|other), notes, occurred_at
- schedule_followup — remind them to follow up. fields: contact_name(req), due_date, notes
- add_to_email_list — add someone to a newsletter/campaign list. fields: email(req), name, list_name
- create_task — a personal to-do. fields: title(req), due_date, notes
- capture_lead — a sales lead with buying interest. fields: name(req), email, company, phone, interest_summary, source
- update_contact — change a known contact's details. fields: contact_identifier(req, current name or email), new_name, new_email, new_phone, new_context
- log_expense — record a business expense. fields: amount(req, digits only), currency, category, description, occurred_at, client_name
- draft_campaign — ask Marketing to draft an email campaign. fields: message_summary(req), subject_hint, target_audience, occasion
- send_for_signature — ask Legal to send a document for signature. fields: document_identifier(req), signer_name, signer_email, signer_contact, notes

Shape: {"intents":[{"type":"<type>","fields":{...},"confidence":0.0-1.0}, ...]}
Return up to 2 candidates, MOST CONFIDENT FIRST. Include a close second ONLY when the message is genuinely ambiguous between two types (e.g. a person with buying interest = capture_lead AND create_contact). Otherwise return one.

Rules:
- Emit an intent ONLY when the message clearly is that action. A question is NOT an intent.
- confidence reflects how clearly the message is that instruction.
- If there is NO clear intent, return exactly: {"intents":[]}`;

function normalize(raw: { type?: string; fields?: Record<string, unknown>; confidence?: number }): IntentResult | null {
  const type = raw.type ?? "";
  if (!KNOWN.has(type)) return null;
  const spec = INTENT_FIELDS[type as IntentType];
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const rawFields = (raw.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const k of spec.keys) {
    const v = rawFields[k];
    if (typeof v === "string" && v.trim()) fields[k] = v.trim();
    else if (typeof v === "number") fields[k] = String(v);
  }
  if (!fields[spec.required]) return null;
  return { type: type as IntentType, fields, confidence };
}

/**
 * Extract ranked intents from a user message. Returns [] when nothing clears
 * the floor, [top] normally, or [top, second] when genuinely ambiguous. Never
 * throws. Caller proceeds with normal routing on [].
 */
export async function extractIntent(userMessage: string, vaultContext?: string): Promise<IntentResult[]> {
  const message = (userMessage ?? "").trim();
  if (!message) return [];

  const res = await callLLM({
    intent: "route",
    system: vaultContext ? `${SYSTEM}\n\nBusiness context (for disambiguation only):\n${vaultContext}` : SYSTEM,
    messages: [{ role: "user", content: message }],
  });
  if (!res.ok) return [];

  let parsed: { intents?: { type?: string; fields?: Record<string, unknown>; confidence?: number }[] };
  try {
    const jsonText = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const candidates = (parsed.intents ?? [])
    .map(normalize)
    .filter((r): r is IntentResult => r !== null)
    .sort((a, b) => b.confidence - a.confidence);

  if (candidates.length === 0 || candidates[0]!.confidence < INTENT_CONFIDENCE_THRESHOLD) return [];
  const top = candidates[0]!;
  const second = candidates[1];
  if (second && second.confidence >= INTENT_CONFIDENCE_THRESHOLD && top.confidence - second.confidence < DISAMBIGUATION_DELTA && second.type !== top.type) {
    return [top, second];
  }
  return [top];
}
