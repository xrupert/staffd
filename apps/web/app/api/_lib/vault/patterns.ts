/**
 * Pattern tracking — "successful pattern" signals from V6.
 *
 * When a user shares / publishes / regenerates / keeps a document, we capture
 * the signal as a `vault_patterns` row AND bump the corresponding
 * `vault_embeddings_index` row(s) + Qdrant point payload(s) to a higher
 * `weight`. The retrieval scorer in `_lib/vault/retrieve.ts` multiplies
 * cosine similarity by `weight` (clamped to 4), so patterns naturally rise
 * above ordinary memory in future searches without any retrieval-side change.
 *
 * Signals + weights (locked):
 *   kept         → 1.5  (explicit save action)
 *   shared       → 2.0  (V6 spec acceptance #1)
 *   published    → 2.5  (went to a real channel — strongest signal)
 *   regenerated  → 1.8  (used as a base for a new generation)
 *
 * Weight semantics: we always take the MAX of the current weight and the
 * incoming signal's weight. A doc that was published (2.5) doesn't lose
 * weight if it's later just shared (2.0).
 *
 * Fail-safe: any subsystem failure (PB, Qdrant) returns a structured result.
 * The HTTP endpoint never 500s.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import { setPayload } from "../qdrant";
import { recomputeVoiceProfile } from "./voice";

export type PatternSignal =
  | "kept"
  | "shared"
  | "published"
  | "regenerated"
  // Phase 5 — outcome-driven signals fed back from Listmonk / Plausible /
  // Twenty / Docuseal etc. via /api/webhooks/* → recordOutcome.
  | "engagement_high"  // unusually high opens / clicks / views
  | "conversion"        // real conversion event (close, sign, sale)
  | "bounce";           // unsubscribe, complaint, hard bounce — downweights

export const PATTERN_WEIGHTS: Record<PatternSignal, number> = {
  kept: 1.5,
  shared: 2.0,
  published: 2.5,
  regenerated: 1.8,
  engagement_high: 2.8,
  conversion: 3.0,
  bounce: 0.4,
};

export const VALID_SIGNALS = new Set<PatternSignal>([
  "kept",
  "shared",
  "published",
  "regenerated",
  "engagement_high",
  "conversion",
  "bounce",
]);

export type RecordPatternResult = {
  ok: boolean;
  weight: number;
  indexRowsUpdated: number;
  qdrantPointsUpdated: number;
  reason?: string;
};

type IndexRow = {
  id: string;
  qdrant_point_id: string;
  collection?: string;
  weight?: number;
  source_id: string;
  parent_id?: string;
};

/**
 * Record a pattern signal for a document. Writes vault_patterns, bumps the
 * weight on every vault_embeddings_index row that references the document
 * (doc-level + all its shards), and mirrors the new weight into the Qdrant
 * point payload so retrieval scoring sees it.
 */
export async function recordPattern(opts: {
  userId: string;
  documentId: string;
  signal: PatternSignal;
  clientId?: string | null;
}): Promise<RecordPatternResult> {
  const newWeight = PATTERN_WEIGHTS[opts.signal];
  if (!newWeight) {
    return { ok: false, weight: 0, indexRowsUpdated: 0, qdrantPointsUpdated: 0, reason: "invalid_signal" };
  }

  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch (err) {
    return {
      ok: false,
      weight: newWeight,
      indexRowsUpdated: 0,
      qdrantPointsUpdated: 0,
      reason: `admin_auth_failed:${String(err)}`,
    };
  }
  const headers = adminHeaders(token);

  // 1. Append the vault_patterns row. Best-effort — we still want to bump
  //    weights even if this write fails.
  try {
    await fetch(`${url}/api/collections/vault_patterns/records`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user: opts.userId,
        client: opts.clientId ?? null,
        document_id: opts.documentId,
        signal: opts.signal,
      }),
    });
  } catch {
    /* proceed with weight bump even if signal log failed */
  }

  // 2. Find every embeddings_index row referencing this document — doc-level
  //    row (source_id = documentId) plus any shards (parent_id = documentId).
  const escapedDoc = pbEscape(opts.documentId);
  const filter = `(source_id='${escapedDoc}' || parent_id='${escapedDoc}')`;
  let rows: IndexRow[] = [];
  try {
    const res = await fetch(
      `${url}/api/collections/vault_embeddings_index/records?filter=${encodeURIComponent(filter)}&perPage=50&fields=id,qdrant_point_id,collection,weight,source_id,parent_id`,
      { headers: { Authorization: token } }
    );
    if (res.ok) {
      const data = (await res.json()) as { items?: IndexRow[] };
      rows = data.items ?? [];
    }
  } catch {
    /* no rows; pattern logged but weight bump skipped */
  }

  if (rows.length === 0) {
    return {
      ok: true,
      weight: newWeight,
      indexRowsUpdated: 0,
      qdrantPointsUpdated: 0,
      reason: "no_index_rows",
    };
  }

  // 3. Bump weight in PB (one PATCH per row). MAX semantics — never lower
  //    an already-higher weight.
  let indexRowsUpdated = 0;
  await Promise.all(
    rows.map(async (row) => {
      const current = typeof row.weight === "number" ? row.weight : 1.0;
      const next = Math.max(current, newWeight);
      if (next === current) {
        indexRowsUpdated++;
        return;
      }
      try {
        const res = await fetch(`${url}/api/collections/vault_embeddings_index/records/${row.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ weight: next }),
        });
        if (res.ok) indexRowsUpdated++;
      } catch {
        /* best-effort */
      }
    })
  );

  // 4. Mirror weight into the Qdrant point payload. Grouped by collection
  //    so each call updates all this-doc points in that user's collection
  //    in one shot.
  const byCollection = new Map<string, string[]>();
  for (const row of rows) {
    const col = row.collection ?? "";
    if (!col) continue;
    const list = byCollection.get(col) ?? [];
    list.push(row.qdrant_point_id);
    byCollection.set(col, list);
  }

  let qdrantPointsUpdated = 0;
  for (const [collection, pointIds] of byCollection.entries()) {
    try {
      await setPayload(collection, pointIds, { weight: newWeight });
      qdrantPointsUpdated += pointIds.length;
    } catch (err) {
      console.warn(`[patterns] Qdrant setPayload failed for ${collection}:`, err);
    }
  }

  // Phase 2 / B3 cadence — high-signal events trigger an incremental voice
  // profile recompute. Fire-and-forget; the user's next agent call will
  // pick up the refreshed voicePromptText.
  if (opts.signal === "published" || opts.signal === "shared") {
    void recomputeVoiceProfile(opts.userId).catch((err) => {
      console.warn(`[patterns] voice recompute failed for ${opts.userId}:`, err);
    });
  }

  return {
    ok: true,
    weight: newWeight,
    indexRowsUpdated,
    qdrantPointsUpdated,
  };
}
