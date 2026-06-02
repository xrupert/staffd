/**
 * Vault retrieval token accounting + trim ladder.
 *
 * The orchestrator passes a hard `maxTokens` cap per intent (see
 * `_lib/orchestrator/policies.ts`). `retrieve()` will never return more
 * text than that — this file is where that promise is enforced.
 *
 * Trim ladder when over the cap:
 *   1. Drop items below normalized score 0.5 first.
 *   2. If still over: replace full shards with their summaries.
 *   3. If still over: keep top-N summaries that fit; drop the rest.
 *   4. If even N=1 summary won't fit: return [] with cost_flag="degraded".
 *
 * Token estimation is the standard ~chars/4 approximation. Cheap, fast, and
 * accurate enough — we'd rather slightly over-estimate than slightly over-spend.
 */

import type { RetrievedItem, RetrievalCostFlag } from "./retrieve";

/** Rough char→token estimator. Good enough for budget enforcement. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Total token estimate for the text actually surfaced from a list of items. */
export function totalTokens(items: RetrievedItem[]): number {
  let n = 0;
  for (const it of items) n += estimateTokens(it.text);
  return n;
}

/**
 * Apply the trim ladder to a scored, sorted (descending) list of items so
 * the total surfaced text fits inside `maxTokens`.
 *
 * Items arrive carrying both a `summary` and (optionally) a `fullText` field;
 * `text` is whatever's currently selected for rendering. We can downgrade a
 * full-shard item to its summary by replacing `text` with `summary` and
 * setting `shard:false`.
 */
export function trimToCap(
  items: RetrievedItem[],
  maxTokens: number
): { items: RetrievedItem[]; costFlag: RetrievalCostFlag; tokensReturned: number } {
  const initial = totalTokens(items);
  if (items.length === 0) {
    return { items, costFlag: "degraded", tokensReturned: 0 };
  }
  if (initial <= Math.floor(maxTokens * 0.8)) {
    return { items, costFlag: "ok", tokensReturned: initial };
  }
  if (initial <= maxTokens) {
    return { items, costFlag: "ok", tokensReturned: initial };
  }

  // Step 1 — drop low-score items first.
  let working = items.filter((it) => it.score >= 0.5);
  let total = totalTokens(working);
  if (working.length > 0 && total <= maxTokens) {
    return { items: working, costFlag: "trimmed", tokensReturned: total };
  }

  // Step 2 — replace shards with summaries.
  let downgraded = false;
  working = working.map((it) => {
    if (it.shard && it.summary && it.summary !== it.text) {
      downgraded = true;
      return { ...it, text: it.summary, shard: false };
    }
    return it;
  });
  total = totalTokens(working);
  if (working.length > 0 && total <= maxTokens) {
    return { items: working, costFlag: "trimmed", tokensReturned: total };
  }

  // Step 3 — keep top-N summaries that fit.
  const summaryOnly = working.map((it) => ({
    ...it,
    text: it.summary || it.text,
    shard: false,
  }));
  const kept: RetrievedItem[] = [];
  let running = 0;
  for (const it of summaryOnly) {
    const t = estimateTokens(it.text);
    if (running + t > maxTokens) break;
    kept.push(it);
    running += t;
  }
  if (kept.length > 0) {
    return { items: kept, costFlag: "degraded", tokensReturned: running };
  }

  // Step 4 — nothing fits.
  return { items: [], costFlag: "degraded", tokensReturned: 0 };
}
