/**
 * Conversational intent extraction (Model B3) — W95.1 + W95.4a.
 *
 * Sibling to analyzer.ts, NOT an extension of it: the analyzer classifies a
 * finished specialist deliverable → action affordances (post-hoc); this reads a
 * RAW user message → intent + structured fields (pre-hoc), so STAFFD can render
 * a confirmation preview before committing.
 *
 * Reuses the existing callLLM plumbing (no new Anthropic call site — W61′
 * 9-site allowlist preserved). W95.4a adds 7 intents to the original
 * create_contact; everything else returns null and normal routing proceeds.
 * Fields are a FLAT string map (the modal + commit path stay generic); update's
 * "new_*" keys and expense's string "amount" are normalized at commit.
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
  | "log_expense";

export type IntentResult = {
  type: IntentType;
  fields: Record<string, string>;
  confidence: number;
};

export const INTENT_CONFIDENCE_THRESHOLD = 0.7;

/** Allowed flat field keys per intent + the one that MUST be present. */
export const INTENT_FIELDS: Record<IntentType, { keys: string[]; required: string }> = {
  create_contact:    { keys: ["name", "email", "phone", "context"], required: "name" },
  log_interaction:   { keys: ["contact_name", "interaction_type", "notes", "occurred_at"], required: "contact_name" },
  schedule_followup: { keys: ["contact_name", "due_date", "notes"], required: "contact_name" },
  add_to_email_list: { keys: ["email", "name", "list_name"], required: "email" },
  create_task:       { keys: ["title", "due_date", "notes"], required: "title" },
  capture_lead:      { keys: ["name", "email", "company", "phone", "interest_summary", "source"], required: "name" },
  update_contact:    { keys: ["contact_identifier", "new_name", "new_email", "new_phone", "new_context"], required: "contact_identifier" },
  log_expense:       { keys: ["amount", "currency", "category", "description", "occurred_at", "client_name"], required: "amount" },
};

const KNOWN = new Set(Object.keys(INTENT_FIELDS));

const SYSTEM = `You extract a single actionable INTENT from a small-business owner's message, if one is clearly present. Return STRICT JSON, no prose.

Intent types and their fields (use these exact field keys; omit keys you can't fill):
- create_contact — add/remember a person. fields: name(req), email, phone, context
- log_interaction — they just talked to someone. fields: contact_name(req), interaction_type(call|email|meeting|other), notes, occurred_at
- schedule_followup — remind them to follow up with someone. fields: contact_name(req), due_date, notes
- add_to_email_list — add someone to a newsletter/campaign list. fields: email(req), name, list_name
- create_task — a personal to-do for the owner. fields: title(req), due_date, notes
- capture_lead — a sales lead with interest. fields: name(req), email, company, phone, interest_summary, source
- update_contact — change a known contact's details. fields: contact_identifier(req, current name or email), new_name, new_email, new_phone, new_context
- log_expense — record a business expense. fields: amount(req, digits only e.g. "45"), currency, category, description, occurred_at, client_name

Shape: {"type":"<one of the above>","fields":{...},"confidence":0.0-1.0}

Rules:
- Emit an intent ONLY when the message is clearly that action. A question ("how do I find leads?") is NOT an intent.
- Pick the SINGLE best-fitting type. Prefer capture_lead over create_contact when there's clear buying interest; prefer update_contact when changing an existing person's details.
- confidence reflects how clearly this is that instruction.
- If there is NO clear intent, return exactly: {"type":"none","confidence":0}`;

/**
 * Extract an intent from a user message. Returns null when no supported intent
 * is present (caller proceeds with normal routing). Never throws.
 */
export async function extractIntent(userMessage: string, vaultContext?: string): Promise<IntentResult | null> {
  const message = (userMessage ?? "").trim();
  if (!message) return null;

  const res = await callLLM({
    intent: "route",
    system: vaultContext ? `${SYSTEM}\n\nBusiness context (for disambiguation only):\n${vaultContext}` : SYSTEM,
    messages: [{ role: "user", content: message }],
  });
  if (!res.ok) return null;

  let parsed: { type?: string; fields?: Record<string, unknown>; confidence?: number };
  try {
    const jsonText = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const type = parsed.type ?? "";
  if (!KNOWN.has(type)) return null;
  const spec = INTENT_FIELDS[type as IntentType];

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const rawFields = (parsed.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const k of spec.keys) {
    const v = rawFields[k];
    if (typeof v === "string" && v.trim()) fields[k] = v.trim();
    else if (typeof v === "number") fields[k] = String(v);
  }
  if (!fields[spec.required]) return null; // required field missing → not a real intent

  return { type: type as IntentType, fields, confidence };
}
