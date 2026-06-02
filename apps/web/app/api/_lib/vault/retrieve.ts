/**
 * Vault retrieval — the read side of the Living Memory layer.
 *
 * Given a query string, returns the top-K semantically relevant artifacts
 * from the user's vault (documents, conversation turns, successful patterns),
 * with all the cost controls the orchestrator's intent policy demands:
 *
 *   • hard token cap per call (`maxTokens`)
 *   • normalized scoring with weights (pattern 2.0×, freshness 1.2×, same-dept 1.3×)
 *   • optional department-weighted retrieval
 *   • minimum score floor (0.35)
 *   • per-user soft cap (200/day) — logged, not enforced
 *   • context cost flag returned to the caller
 *   • one row written to `vault_retrieval_metrics` per call
 *
 * Fail-safe: any error in embeddings, Qdrant, or PB returns `[]` with
 * cost_flag:"degraded". The caller (orchestrator wrapper) will see this and
 * proceed without the LIVING MEMORY block — never a 500.
 */

import { embed } from "../embeddings";
import { search, userCollection, type QdrantSearchHit, type QdrantPayload } from "../qdrant";
import { trimToCap, estimateTokens } from "./budget";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";

export type RetrievalCostFlag = "ok" | "trimmed" | "degraded";

export type RetrievedItem = {
  id: string;
  sourceKind: QdrantPayload["source_kind"];
  sourceId: string;
  parentId?: string;
  dept?: string;
  summary: string;          // always populated (denormalized from vault_embeddings_index)
  text: string;             // current rendered text (may equal summary after trim)
  shard: boolean;           // true if this is a document_shard (full text)
  weight: number;
  score: number;            // normalized to [0,1] after weighting
  rawScore: number;         // raw cosine from Qdrant
  createdIso?: string;
};

export type RetrieveOptions = {
  topK?: number;                          // default 10; orchestrator can request 3/5/10
  maxTokens: number;                      // hard cap (see policies.ts)
  weights?: Record<string, number>;       // dept → multiplier
  clientId?: string | null;               // Agency mode
  intent?: "route" | "handoff" | "brief" | "synthesize" | "agent";
  preferDept?: string;                    // same-dept 1.3× boost
};

export type RetrieveResult = {
  items: RetrievedItem[];
  costFlag: RetrievalCostFlag;
  tokensReturned: number;
  latencyMs: number;
  provider?: "voyage" | "openai";
};

const MIN_SCORE = 0.35;
const PATTERN_BOOST = 2.0;
const FRESHNESS_BOOST = 1.2;
const FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SAME_DEPT_BOOST = 1.3;

function normalizeRawCosine(raw: number): number {
  // Voyage and OpenAI both return normalized vectors → cosine in [-1, 1].
  // Map to [0,1].
  return Math.max(0, Math.min(1, (raw + 1) / 2));
}

function applyWeights(hit: QdrantSearchHit, opts: RetrieveOptions): { weight: number; norm: number } {
  const baseNorm = normalizeRawCosine(hit.score);
  let weight = hit.payload.weight ?? 1.0;

  // Pattern boost — patterns are stored with weight ≥ 2.0 in vault_embeddings_index,
  // but defensive in case the index drifted.
  if (hit.payload.source_kind === "pattern" && weight < PATTERN_BOOST) {
    weight = PATTERN_BOOST;
  }

  // Freshness boost — items younger than 30 days get a 1.2× nudge.
  if (hit.payload.created) {
    const age = Date.now() - new Date(hit.payload.created).getTime();
    if (age >= 0 && age <= FRESHNESS_WINDOW_MS) weight *= FRESHNESS_BOOST;
  }

  // Same-dept boost — if caller has a preferred dept and this hit matches.
  if (opts.preferDept && hit.payload.dept === opts.preferDept) {
    weight *= SAME_DEPT_BOOST;
  }

  // Optional explicit per-dept weights from caller (orchestrator may pass e.g.
  // {marketing: 1.5, sales: 1.0} for an intent that should bias retrieval).
  if (opts.weights && hit.payload.dept && opts.weights[hit.payload.dept] !== undefined) {
    weight *= opts.weights[hit.payload.dept]!;
  }

  // Score after weighting; clamp to [0,1].
  const weighted = Math.max(0, Math.min(1, baseNorm * Math.min(weight, 4)));
  return { weight, norm: weighted };
}

/**
 * Main retrieval entry point.
 *
 * Step order:
 *   1. embed(query)
 *   2. Qdrant search (top-K + a bit of headroom for filtering)
 *   3. apply weights → normalized score
 *   4. drop items below MIN_SCORE
 *   5. sort by score desc
 *   6. trim to maxTokens via budget.ts ladder
 *   7. write vault_retrieval_metrics row (fire-and-forget)
 *   8. return
 */
export async function retrieve(
  userId: string,
  query: string,
  opts: RetrieveOptions
): Promise<RetrieveResult> {
  const start = Date.now();
  const topK = opts.topK ?? 10;
  const headroom = Math.max(topK * 2, 20); // pull more than needed; trim/filter locally
  const empty = (cost: RetrievalCostFlag): RetrieveResult => ({
    items: [],
    costFlag: cost,
    tokensReturned: 0,
    latencyMs: Date.now() - start,
  });

  if (!userId || !query.trim()) {
    void recordRetrievalMetric(userId, opts.intent, Date.now() - start, 0, 0, "degraded");
    return empty("degraded");
  }
  if (opts.maxTokens < 100) {
    // Tiny caps degrade by definition — return early so we don't waste an embedding.
    void recordRetrievalMetric(userId, opts.intent, Date.now() - start, 0, 0, "degraded");
    return empty("degraded");
  }

  let provider: "voyage" | "openai" | undefined;
  let hits: QdrantSearchHit[] = [];
  try {
    const embedded = await embed(query, { timeoutMs: 3_000 });
    provider = embedded.provider;
    const collection = userCollection(userId, opts.clientId ?? null);
    hits = await search(collection, embedded.vector, {
      limit: headroom,
      client: opts.clientId ?? null,
    });
  } catch (err) {
    console.warn("[retrieve] upstream error — returning degraded:", err);
    void recordRetrievalMetric(userId, opts.intent, Date.now() - start, 0, 0, "degraded");
    return { ...empty("degraded"), provider };
  }

  // Apply weights, filter by floor, sort.
  const scored: RetrievedItem[] = hits
    .map((h) => {
      const { weight, norm } = applyWeights(h, opts);
      const summary = h.payload.summary ?? "";
      const shard = h.payload.source_kind === "document_shard";
      return {
        id: h.id,
        sourceKind: h.payload.source_kind,
        sourceId: h.payload.source_id,
        parentId: h.payload.parent_id,
        dept: h.payload.dept,
        summary,
        text: summary, // V2 ships summary-only text; full-shard text comes online in V4
        shard,
        weight,
        score: norm,
        rawScore: h.score,
        createdIso: h.payload.created,
      };
    })
    .filter((it) => it.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Trim to token cap.
  const { items, costFlag, tokensReturned } = trimToCap(scored, opts.maxTokens);

  const latencyMs = Date.now() - start;
  void recordRetrievalMetric(userId, opts.intent, latencyMs, items.length, tokensReturned, costFlag);

  return { items, costFlag, tokensReturned, latencyMs, provider };
}

/** Fire-and-forget write to vault_retrieval_metrics. Errors swallowed. */
export async function recordRetrievalMetric(
  userId: string,
  intent: RetrieveOptions["intent"] | undefined,
  latencyMs: number,
  itemsReturned: number,
  tokensReturned: number,
  costFlag: RetrievalCostFlag
): Promise<void> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    await fetch(`${url}/api/collections/vault_retrieval_metrics/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: userId,
        intent: intent ?? null,
        latency_ms: latencyMs,
        items_returned: itemsReturned,
        tokens_returned: tokensReturned,
        cost_flag: costFlag,
      }),
    });
  } catch {
    /* metrics are best-effort */
  }
}

/**
 * Compute p95 retrieval latency per user over the last `daysBack` days.
 * Returns a map of userId → p95 ms plus a global p95. Used by the scheduled
 * worker to surface vault hot-spots in the admin dashboard.
 */
export async function computeRetrievalP95(daysBack = 1): Promise<{
  globalP95Ms: number;
  byUser: Record<string, { p95Ms: number; samples: number }>;
  samples: number;
}> {
  const empty = { globalP95Ms: 0, byUser: {}, samples: 0 };
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    const filter = `(created>='${pbEscape(since)}')`;

    const res = await fetch(
      `${url}/api/collections/vault_retrieval_metrics/records?filter=${encodeURIComponent(filter)}&perPage=500&sort=-created&fields=user,latency_ms`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      items?: Array<{ user: string; latency_ms: number }>;
    };
    const items = data.items ?? [];
    if (items.length === 0) return empty;

    const byUserSamples = new Map<string, number[]>();
    const all: number[] = [];
    for (const it of items) {
      if (typeof it.latency_ms !== "number") continue;
      all.push(it.latency_ms);
      const arr = byUserSamples.get(it.user) ?? [];
      arr.push(it.latency_ms);
      byUserSamples.set(it.user, arr);
    }

    const p95 = (xs: number[]): number => {
      if (xs.length === 0) return 0;
      const sorted = [...xs].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      return sorted[idx]!;
    };

    const byUser: Record<string, { p95Ms: number; samples: number }> = {};
    for (const [u, xs] of byUserSamples) {
      byUser[u] = { p95Ms: p95(xs), samples: xs.length };
    }

    return { globalP95Ms: p95(all), byUser, samples: all.length };
  } catch {
    return empty;
  }
}

// Re-export so callers can do `import { estimateTokens } from "../vault"`.
export { estimateTokens };
