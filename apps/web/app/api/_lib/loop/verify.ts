/**
 * Loop layer — output verify-or-correct (PR-Loop-V3, upgrade map #5).
 *
 * The diamond's verification node for single-call surfaces (CEO brief /
 * synthesize): grade the merged output against the same objective
 * evidence as workflow tasks; on failure, ONE corrective regeneration
 * with the grader's feedback; if that also fails, report unverified so
 * the caller degrades honestly instead of shipping a bad deliverable to
 * the flagship surface.
 *
 * (The diamond's fan-out half already exists — the handlers' context
 * fetches run per-department in parallel. This adds the missing middle.)
 */

import { gradeTaskOutput, graderRetryInstruction } from "./grader";

export type VerifyOutcome =
  | { verified: true; text: string; corrected: boolean }
  | { verified: false; reasons: string[] };

export async function verifyOrCorrect(opts: {
  text: string;
  /** One corrective attempt: called with the retry instruction to append
   *  to the original prompt/system. Return ok:false to skip correction. */
  regenerate: (retryInstruction: string) => Promise<{ ok: boolean; text?: string }>;
}): Promise<VerifyOutcome> {
  const first = gradeTaskOutput({ text: opts.text, isSystemTask: false });
  if (first.pass) return { verified: true, text: opts.text, corrected: false };

  const retry = await opts.regenerate(graderRetryInstruction(first.reasons.join("; "))).catch(
    () => ({ ok: false as const, text: undefined }),
  );
  if (retry.ok && retry.text) {
    const second = gradeTaskOutput({ text: retry.text, isSystemTask: false });
    if (second.pass) return { verified: true, text: retry.text, corrected: true };
    return { verified: false, reasons: second.reasons };
  }
  return { verified: false, reasons: first.reasons };
}
