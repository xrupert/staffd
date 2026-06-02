/**
 * Per-job ingestion logic — the function the V4a worker dispatches to.
 *
 * `runIngestJob(row)` is the single entry point. It branches by `row.kind`
 * and never throws for "expected" failures (missing source, empty content,
 * provider mismatch, etc.) — those come back as `{ok:false, reason:"..."}`
 * so the worker can decide retry vs. dead-letter. Only `RateLimitedError`
 * is allowed to bubble; the worker catches it specifically and requeues
 * without incrementing `attempts`.
 *
 * Spec: Roadmap v2 §V4b.
 */

import { createHash } from "node:crypto";

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../pb";
import { embed, providerDim, type EmbeddingProvider } from "../embeddings";
import {
  ensureCollection,
  upsert,
  userCollection,
  type QdrantPoint,
} from "../qdrant";
import { estimateTokens } from "./budget";
import { summarizeAndIndexDocument, summarizeText } from "./summarize";
import type { IngestRow } from "./queue";

const PRIMARY_PROVIDER: EmbeddingProvider = process.env.VOYAGE_API_KEY
  ? "voyage"
  : "openai";

export type IngestJobResult = {
  ok: boolean;
  reason?: string;
  skipped?: boolean;
  pointsCreated?: number;
  fellBackToExtractive?: boolean;
};

function stableUuid(input: string): string {
  const hex = createHash("sha1").update(input).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "5" + hex.slice(13, 16),
    "a" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Dispatch by kind. Worker calls this once per claimed row.
 */
export async function runIngestJob(row: IngestRow): Promise<IngestJobResult> {
  switch (row.kind) {
    case "document": {
      // Phase 24 — `row.force` propagates the user-edited-this-doc signal
      // through to summarizeAndIndexDocument, which purges + re-indexes.
      const result = await summarizeAndIndexDocument(row.source_id, { force: !!row.force });
      return result.ok
        ? {
            ok: true,
            skipped: result.skipped,
            reason: result.reason,
            pointsCreated: result.pointsCreated,
            fellBackToExtractive: result.fellBackToExtractive,
          }
        : { ok: false, reason: result.reason, fellBackToExtractive: result.fellBackToExtractive };
    }
    case "conversation":
      return ingestConversationTurn(row.source_id);
    case "shard":
      // Shards are produced inline by `summarizeAndIndexDocument`; the shard
      // queue kind exists for future fine-grained re-indexing. No-op today.
      return { ok: true, skipped: true, reason: "shard_kind_reserved" };
    case "backfill":
      // Backfill is a marker kind — the backfill script enqueues real
      // document rows. If one of these slips through, mark done.
      return { ok: true, skipped: true, reason: "backfill_marker_noop" };
  }
}

type ConversationRow = {
  id: string;
  user: string;
  client?: string | null;
  thread_id?: string;
  department?: string;
  agent_id?: string;
  role: string;
  content: string;
  document_id?: string;
  created: string;
};

/**
 * Summarize + embed a single conversation turn. One Qdrant point per turn,
 * no sharding — turns are short-form by construction.
 *
 * V5 will wire the producer (every /api/agent turn writes a `conversations`
 * row and fires `enqueue("conversation", turnId)`); V4b ships the consumer
 * so the worker is ready when V5 ships.
 */
export async function ingestConversationTurn(turnId: string): Promise<IngestJobResult> {
  if (!turnId) return { ok: false, reason: "missing_turn_id" };

  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch (err) {
    return { ok: false, reason: `admin_auth_failed:${String(err)}` };
  }
  const headers = adminHeaders(token);

  // 1. Fetch the turn.
  let turn: ConversationRow;
  try {
    const res = await fetch(
      `${url}/api/collections/conversations/records/${encodeURIComponent(turnId)}`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return { ok: false, reason: "conversation_turn_not_found" };
    turn = (await res.json()) as ConversationRow;
  } catch (err) {
    return { ok: false, reason: `fetch_failed:${String(err)}` };
  }

  if (!turn.content?.trim()) return { ok: false, reason: "empty_content" };

  // 2. Idempotency — if any vault_embeddings_index row references this turn,
  //    we've already indexed it.
  try {
    const existing = await pbFirst<{ id: string }>(
      "vault_embeddings_index",
      `(source_id='${pbEscape(turnId)}')`,
      token,
      { fields: "id" }
    );
    if (existing) {
      return { ok: true, skipped: true, reason: "already_indexed" };
    }
  } catch {
    /* fall through; PB unique index will catch true duplicates */
  }

  // 3. Summarize the turn. RateLimitedError from summarizeText / embed
  //    bubbles all the way out to the worker (per V4a's contract).
  const tokens = estimateTokens(turn.content);
  const { summary, fallback } = await summarizeText(turn.content);
  if (!summary) return { ok: false, reason: "summary_empty" };

  // 4. Embed — pinned to the primary provider to keep collection dims stable.
  const embedded = await embed(summary, { preferProvider: PRIMARY_PROVIDER });
  if (embedded.provider !== PRIMARY_PROVIDER) {
    return { ok: false, reason: "provider_mismatch" };
  }

  // 5. Upsert into the user's (or agency client's) Qdrant collection.
  const collection = userCollection(turn.user, turn.client ?? null);
  try {
    await ensureCollection(collection, providerDim(PRIMARY_PROVIDER));
  } catch (err) {
    return { ok: false, reason: `qdrant_ensure_failed:${String(err)}` };
  }

  const point: QdrantPoint = {
    id: stableUuid(`conv:${turnId}`),
    vector: embedded.vector,
    payload: {
      user: turn.user,
      client: turn.client ?? null,
      source_kind: "conversation",
      source_id: turnId,
      dept: turn.department,
      summary,
      weight: 1.0,
      created: turn.created,
      tokens,
    },
  };

  try {
    await upsert(collection, [point]);
  } catch (err) {
    return { ok: false, reason: `qdrant_upsert_failed:${String(err)}` };
  }

  // 6. Write the index row. Non-fatal — Qdrant is the source of truth for
  //    retrieval; PB row is for UI surfacing + pattern boosts.
  try {
    await fetch(`${url}/api/collections/vault_embeddings_index/records`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user: turn.user,
        client: turn.client ?? null,
        source_kind: "conversation",
        source_id: turnId,
        qdrant_point_id: point.id,
        collection,
        summary,
        dept: turn.department,
        weight: 1.0,
        tokens,
      }),
    });
  } catch {
    /* best-effort */
  }

  return { ok: true, pointsCreated: 1, fellBackToExtractive: fallback };
}
