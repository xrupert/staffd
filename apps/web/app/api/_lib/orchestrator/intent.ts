/**
 * W95.1 — conversational intent extraction (Model B3).
 *
 * Sibling to analyzer.ts, NOT an extension of it: the analyzer classifies a
 * finished specialist deliverable → action affordances (post-hoc); this reads a
 * RAW user message → intent + structured fields (pre-hoc), so STAFFD can render
 * a confirmation preview before committing.
 *
 * Reuses the existing callLLM plumbing (no new Anthropic call site — W61′
 * 9-site allowlist preserved). V1 handles ONE type, create_contact; everything
 * else returns null and the normal specialist flow proceeds unchanged. New
 * parsers are added here in W95.4 without touching callers.
 */

import { callLLM } from "./llm";

export type IntentType = "create_contact";

export type IntentResult = {
  type: IntentType;
  fields: Record<string, string>;
  confidence: number;
};

/**
 * Confidence floor for surfacing the confirmation modal. 0.7 chosen
 * deliberately: extraction false-positives are cheap (the modal lets the user
 * cancel and the normal chat continues), but a too-low bar would interrupt
 * ordinary questions with a contact form. 0.7 keeps "I met Jane, email x" in
 * while letting "what should I email a new lead?" fall through to routing.
 * Tunable as we instrument confirm/edit/reject rates (W95.1 deliverable).
 */
export const INTENT_CONFIDENCE_THRESHOLD = 0.7;

const SYSTEM = `You extract a single actionable INTENT from a small-business owner's message, if one is clearly present.

Only one intent type exists right now: "create_contact" — the user is telling you about a person to add to their contacts (a name, usually with an email/phone, often with context like where they met).

Return STRICT JSON, no prose, in this shape:
{"type":"create_contact","fields":{"name":"...","email":"...","phone":"...","context":"..."},"confidence":0.0-1.0}

Rules:
- Only emit create_contact when the message is clearly about adding/remembering a specific person. A question ("how do I find leads?") is NOT a contact.
- name is required; email/phone/context optional (omit keys you can't fill).
- confidence reflects how clearly this is a contact-capture instruction.
- If there is NO clear contact-capture intent, return exactly: {"type":"none","confidence":0}`;

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

  if (parsed.type !== "create_contact") return null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const rawFields = (parsed.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const k of ["name", "email", "phone", "context"]) {
    const v = rawFields[k];
    if (typeof v === "string" && v.trim()) fields[k] = v.trim();
  }
  if (!fields.name) return null; // name is required to be a real contact

  return { type: "create_contact", fields, confidence };
}
