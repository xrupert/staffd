/**
 * Loop layer — output grader (PR-Loop-V1, upgrade map #2).
 *
 * The verification half of Doer→Grader→Retry: every workflow-task output
 * is checked against OBJECTIVE EVIDENCE before it counts as succeeded.
 * Stop on evidence, never on model confidence (Arch Spec #19's golden
 * rule — see docs/architecture/STAFFD-HLG-ASSESSMENT.md).
 *
 * v1 is deliberately deterministic — no LLM judge. Every check is a
 * regex/length test that is fast, free, and cannot itself hallucinate.
 * An LLM-judge tier can be added later as a second dep without touching
 * the drain contract.
 *
 * Failure semantics: a failed grade flows into the drain's EXISTING
 * retry machinery (retrying → failed at 3 attempts) with the grader's
 * reasons stashed as feedback the next attempt can act on.
 */

export type GradeVerdict = { pass: true } | { pass: false; reasons: string[] };

/**
 * Vendor tokens that must NEVER surface in customer-facing work product
 * (Model B3 — invisible backends; the brand-voice CI grep enforces this
 * for our own copy, this enforces it for generated work). Only
 * unambiguous tokens: common words that happen to be vendor names
 * (twenty, stripe, paddle) are excluded to avoid false rejections.
 */
const VENDOR_LEAK_RE =
  /\b(muapi|listmonk|chatwoot|docuseal|plausible\.io|postiz|anthropic|groq|openai|gpt-[45]|pocketbase|qdrant|claude)\b/i;

/** Refusal/apology-shaped openings — the model apologizing instead of working. */
const REFUSAL_RE =
  /^(i'm sorry|i am sorry|i apolog|i can(?:'|n)ot|i can't|i am unable|i'm unable|unfortunately,? i)/i;

const ERROR_SHAPED_RE = /^(\{"error"|agent call failed|upstream_error|deadline_exceeded)/i;

const MIN_ARTIFACT_CHARS = 40;

export function gradeTaskOutput(input: {
  text: string;
  /** WORKER_HANDLERS bus tasks (mirrors, extraction) are API calls with
   *  their own throw semantics — not prose deliverables. Never graded. */
  isSystemTask: boolean;
}): GradeVerdict {
  if (input.isSystemTask) return { pass: true };

  const text = (input.text ?? "").trim();
  const reasons: string[] = [];

  if (text.length < MIN_ARTIFACT_CHARS) {
    reasons.push(`artifact_too_short: deliverable is ${text.length} chars — a real work product is required`);
  }
  if (REFUSAL_RE.test(text)) {
    reasons.push("refusal_shaped: the output apologizes or declines instead of producing the deliverable");
  }
  if (ERROR_SHAPED_RE.test(text)) {
    reasons.push("error_shaped: the output is an error payload, not a deliverable");
  }
  const leak = text.match(VENDOR_LEAK_RE);
  if (leak) {
    reasons.push(`vendor_leak: customer-facing work must never name backend vendors (found "${leak[0]}")`);
  }

  return reasons.length === 0 ? { pass: true } : { pass: false, reasons };
}

/** The retry-prompt suffix built from grader feedback (kept here so the
 *  drain route and tests share one canonical form). */
export function graderRetryInstruction(feedback: string): string {
  return `\n\nQUALITY REVIEW — your previous draft was rejected for these reasons: ${feedback}. Produce the complete corrected deliverable, fixing every issue. Do not mention this review in the output.`;
}
