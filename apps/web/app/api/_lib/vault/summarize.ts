/**
 * Vault summarization layer.
 *
 * Three things this file owns:
 *
 *   1. `summarizeText`       — Haiku-backed compression of any chunk of text
 *                              into a ≤600-char single paragraph, with a
 *                              deterministic extractive fallback on failure.
 *   2. `chunkIntoShards`     — Slice oversized documents into 800–1200 token
 *                              shards with 100-token overlap on sentence
 *                              boundaries when available.
 *   3. `summarizeAndIndexDocument` — the end-to-end pipeline that turns one
 *                              PocketBase `documents` row into:
 *                                • 1 doc-level summary + N shard summaries
 *                                • 1 Qdrant point per summary
 *                                • 1 `vault_embeddings_index` row per point
 *                                • a PATCH onto `documents.summary` + `.tokens`
 *
 *  V4a will call this from the ingestion worker; V4b will wrap it via
 *  `runIngestJob`. V3's responsibility is the per-document logic itself,
 *  including idempotency.
 *
 *  Spec: Roadmap v2 §V3. Acceptance: a 5 000-token doc produces 1 + 5 shards,
 *  all persisted, median wall-clock ≤ 6 s, Haiku outage → extractive +
 *  `summarize.fallback:extractive` log.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../pb";
import { embed, providerDim, type EmbeddingProvider } from "../embeddings";
import {
  deletePoints,
  ensureCollection,
  upsert,
  userCollection,
  type QdrantPoint,
  type QdrantPayload,
} from "../qdrant";
import { estimateTokens } from "./budget";
import { acquireUpstream, RateLimitedError } from "./ratelimit";

const anthropic = new Anthropic();

// Model + budgets — locked per Roadmap v2.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SUMMARY_MAX_CHARS = 600;
const SUMMARY_MAX_TOKENS = 256;
const SUMMARY_DEADLINE_MS = 4_000;
const SUMMARY_RETRIES = 1; // single retry, then extractive fallback

// Chunking knobs (token estimates use the ~chars/4 convention from budget.ts).
const TARGET_TOKENS_PER_SHARD = 1_000;
const MAX_TOKENS_PER_SHARD = 1_200;
const SHARD_OVERLAP_TOKENS = 100;
const TARGET_CHARS = TARGET_TOKENS_PER_SHARD * 4; // 4 000
const MAX_CHARS = MAX_TOKENS_PER_SHARD * 4;       // 4 800
const OVERLAP_CHARS = SHARD_OVERLAP_TOKENS * 4;   // 400

// Per V2: hard cap on stored full text per document.
const MAX_DOC_CHARS = 60_000;
// Per V2: cap on what we feed Haiku for the doc-level summary so a 200 k char
// transcript doesn't burn ten thousand tokens just to summarize itself.
const HAIKU_INPUT_CAP_CHARS = 30_000;

/** Primary embedding provider for new Qdrant collections. */
const PRIMARY_PROVIDER: EmbeddingProvider = process.env.VOYAGE_API_KEY
  ? "voyage"
  : "openai";

const SUMMARY_SYSTEM_PROMPT = `You produce one-paragraph factual summaries of business documents and conversation turns for a semantic search index.

RULES:
- Output a SINGLE paragraph of plain text.
- No markdown, bullet points, headings, or quotes.
- 600 characters or less.
- Capture: what the artifact is, who it's for, the main topic, distinct nouns / entities mentioned (names, products, numbers).
- Never write "This document is..." — write the substance directly.
- Never editorialize or interpret. Summarize what's present.

Output ONLY the paragraph. No preamble.`;

// ──────────────────────────────────────────────────────────────────────────
// 1. summarizeText + extractive fallback
// ──────────────────────────────────────────────────────────────────────────

/**
 * Deterministic, no-LLM summary. Used when Haiku is unavailable or fails twice.
 * Pattern: first sentence + last sentence + first 200 chars, capped at 600.
 */
export function extractiveSummary(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= SUMMARY_MAX_CHARS) return clean;

  const firstSentenceMatch = clean.match(/^[^.!?]+[.!?]/);
  const firstSentence = (firstSentenceMatch?.[0] ?? clean.slice(0, 200)).trim();

  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const lastSentence = sentences.length > 1 ? sentences[sentences.length - 1]!.trim() : "";

  let out = firstSentence;
  if (lastSentence && lastSentence !== firstSentence) {
    out = `${firstSentence} … ${lastSentence}`;
  }
  if (out.length < 200) {
    out = clean.slice(0, 200);
  }
  return out.slice(0, SUMMARY_MAX_CHARS).trim();
}

export type SummaryResult = {
  summary: string;
  /** True when the extractive fallback was used (logged as summarize.fallback:extractive). */
  fallback: boolean;
};

/**
 * Compress `text` into a single ≤600-char paragraph via Haiku 4.5.
 * Falls back to `extractiveSummary` after `SUMMARY_RETRIES + 1` failed attempts
 * or when `ANTHROPIC_API_KEY` is unset.
 */
export async function summarizeText(text: string): Promise<SummaryResult> {
  const clean = text?.trim() ?? "";
  if (!clean) return { summary: "", fallback: false };

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("summarize.fallback:extractive (reason=no_api_key)");
    return { summary: extractiveSummary(clean), fallback: true };
  }

  const input = clean.length > HAIKU_INPUT_CAP_CHARS
    ? clean.slice(0, HAIKU_INPUT_CAP_CHARS)
    : clean;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= SUMMARY_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUMMARY_DEADLINE_MS);
    try {
      // Per-invocation Haiku token bucket. RateLimitedError bubbles past the
      // extractive fallback so the ingestion worker can requeue the job
      // without counting it against the attempt budget.
      acquireUpstream("haiku");
      const msg = await anthropic.messages.create(
        {
          model: HAIKU_MODEL,
          max_tokens: SUMMARY_MAX_TOKENS,
          system: [
            {
              type: "text",
              text: SUMMARY_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: input }],
        },
        { signal: ctrl.signal }
      );
      const block = msg.content[0];
      const raw = (block?.type === "text" ? block.text : "").trim();
      if (raw.length > 0) {
        return { summary: raw.slice(0, SUMMARY_MAX_CHARS), fallback: false };
      }
      // Empty response from the model — try again.
      lastErr = new Error("haiku_empty_response");
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn("summarize.fallback:extractive (reason=haiku_failed)", lastErr);
  return { summary: extractiveSummary(clean), fallback: true };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. chunkIntoShards — semantic chunking with overlap
// ──────────────────────────────────────────────────────────────────────────

/**
 * Split `text` into shards of 800–1 200 tokens (target ~1 000) with a
 * 100-token overlap. Chunk boundaries snap to the next sentence break past
 * the target when one is available; otherwise we cut at the hard cap.
 *
 * Returns `[text]` unchanged if the input is already within one shard.
 */
export function chunkIntoShards(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (estimateTokens(t) <= MAX_TOKENS_PER_SHARD) return [t];

  const chunks: string[] = [];
  let pos = 0;

  while (pos < t.length) {
    let end = Math.min(t.length, pos + MAX_CHARS);

    // Snap to a sentence break in [TARGET_CHARS, MAX_CHARS] when possible.
    if (end < t.length) {
      const slice = t.slice(pos, end);
      const pattern = /[.!?]\s+/g;
      let match: RegExpExecArray | null;
      let snap = -1;
      while ((match = pattern.exec(slice)) !== null) {
        if (match.index >= TARGET_CHARS) {
          snap = match.index + match[0].length;
          break;
        }
      }
      if (snap > 0) end = pos + snap;
    }

    const piece = t.slice(pos, end).trim();
    if (piece.length > 0) chunks.push(piece);

    if (end >= t.length) break;

    // Advance with overlap. Never go backwards.
    const next = end - OVERLAP_CHARS;
    pos = next > pos ? next : end;
  }

  return chunks;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. summarizeAndIndexDocument — the end-to-end pipeline
// ──────────────────────────────────────────────────────────────────────────

export type IndexDocumentResult = {
  ok: boolean;
  documentId: string;
  pointsCreated: number;
  shards: number;
  fellBackToExtractive: boolean;
  skipped?: boolean;
  reason?: string;
  durationMs: number;
};

type DocumentRow = {
  id: string;
  user: string;
  client?: string | null;
  department?: string;
  agent_name?: string;
  prompt?: string;
  output?: string;
  created: string;
};

/**
 * Stable, deterministic UUID v5-style string derived from `input`.
 * Qdrant requires point IDs to be unsigned integers or UUID strings.
 */
function stableUuid(input: string): string {
  const hex = createHash("sha1").update(input).digest("hex");
  // RFC 4122 section 4.4 layout — set the version (5) and the variant bits.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "5" + hex.slice(13, 16),
    "a" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The end-to-end pipeline. Idempotent: re-running on a document that already
 * has any `vault_embeddings_index` row returns `skipped:true` unless
 * `opts.force` is set.
 *
 * Fail-safe: any subsystem failure (Haiku, embeddings, Qdrant, PB) produces
 * a structured result, never a throw, so V4's queue can decide retry vs.
 * dead-letter without try/catch around every call.
 */
export async function summarizeAndIndexDocument(
  documentId: string,
  opts?: { force?: boolean }
): Promise<IndexDocumentResult> {
  const t0 = Date.now();
  const fail = (reason: string, extra?: Partial<IndexDocumentResult>): IndexDocumentResult => ({
    ok: false,
    documentId,
    pointsCreated: 0,
    shards: 0,
    fellBackToExtractive: false,
    reason,
    durationMs: Date.now() - t0,
    ...extra,
  });

  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch (err) {
    return fail("admin_auth_failed", { reason: String(err) });
  }
  const headers = adminHeaders(token);

  // 1. Fetch the document.
  let doc: DocumentRow;
  try {
    const docRes = await fetch(
      `${url}/api/collections/documents/records/${encodeURIComponent(documentId)}`,
      { headers: { Authorization: token } }
    );
    if (!docRes.ok) return fail("document_not_found");
    doc = (await docRes.json()) as DocumentRow;
  } catch (err) {
    return fail("document_fetch_failed", { reason: String(err) });
  }

  if (!doc.output?.trim()) return fail("empty_output");

  // 2. Idempotency / force-reindex branch.
  //
  // Default (no force): bail if anything is already indexed for this doc.
  // Force (Phase 24): purge existing vault_embeddings_index rows AND their
  // Qdrant points before re-running so the edit replaces the stale memory
  // cleanly instead of accumulating duplicates.
  if (opts?.force) {
    try {
      const escapedDoc = pbEscape(documentId);
      const filter = `(source_id='${escapedDoc}' || parent_id='${escapedDoc}')`;
      const listRes = await fetch(
        `${url}/api/collections/vault_embeddings_index/records?filter=${encodeURIComponent(filter)}&perPage=50&fields=id,qdrant_point_id,collection`,
        { headers: { Authorization: token } }
      );
      if (listRes.ok) {
        const listData = (await listRes.json()) as {
          items?: Array<{ id: string; qdrant_point_id: string; collection?: string }>;
        };
        const rows = listData.items ?? [];
        // Group qdrant points by collection so each delete hits one endpoint.
        const byCollection = new Map<string, string[]>();
        for (const r of rows) {
          const col = r.collection ?? "";
          if (!col) continue;
          const list = byCollection.get(col) ?? [];
          list.push(r.qdrant_point_id);
          byCollection.set(col, list);
        }
        for (const [col, ids] of byCollection.entries()) {
          try { await deletePoints(col, ids); } catch (err) {
            console.warn(`[summarize.force] qdrant delete failed for ${col}:`, err);
          }
        }
        // Then delete the PB index rows in parallel.
        await Promise.all(
          rows.map((r) =>
            fetch(`${url}/api/collections/vault_embeddings_index/records/${r.id}`, {
              method: "DELETE",
              headers: { Authorization: token },
            }).catch(() => undefined)
          )
        );
      }
    } catch (err) {
      console.warn(`[summarize.force] purge failed for ${documentId}:`, err);
      // Continue — duplicate insert protection via unique index on qdrant_point_id.
    }
  } else {
    try {
      const existing = await pbFirst<{ id: string }>(
        "vault_embeddings_index",
        `(source_id='${pbEscape(documentId)}')`,
        token,
        { fields: "id" }
      );
      if (existing) {
        return {
          ok: true,
          documentId,
          pointsCreated: 0,
          shards: 0,
          fellBackToExtractive: false,
          skipped: true,
          reason: "already_indexed",
          durationMs: Date.now() - t0,
        };
      }
    } catch {
      // Treat lookup failure as "not found" and proceed — duplicate writes will
      // collide on the unique index and be skipped.
    }
  }

  // 3. Truncate output per the V2 60 k-char hard cap; compute tokens once.
  const truncated = doc.output.length > MAX_DOC_CHARS;
  const output = truncated ? doc.output.slice(0, MAX_DOC_CHARS) : doc.output;
  const totalTokens = estimateTokens(output);

  // 4. Build the summarization batch: one doc-level summary + N shard summaries.
  const shardTexts = totalTokens > MAX_TOKENS_PER_SHARD ? chunkIntoShards(output) : [];

  // Parallelize all Haiku calls — V3 acceptance #3 (median ≤ 6 s end-to-end).
  // The doc-level summary always uses the doc as a whole (HAIKU_INPUT_CAP_CHARS
  // applied inside summarizeText).
  const summaryJobs: Array<Promise<SummaryResult>> = [
    summarizeText(output),
    ...shardTexts.map((s) => summarizeText(s)),
  ];
  const summaryResults = await Promise.all(summaryJobs);

  const docSummary = summaryResults[0]!.summary;
  const fellBackToExtractive = summaryResults.some((r) => r.fallback);

  if (!docSummary) {
    return fail("summary_empty", { fellBackToExtractive });
  }

  // 5. Build the list of points to embed: 1 doc-level + 1 per shard.
  type EmbedTarget = {
    pointKey: string;
    embedText: string;
    payload: QdrantPayload;
  };

  const targets: EmbedTarget[] = [
    {
      pointKey: `doc:${doc.id}`,
      embedText: docSummary,
      payload: {
        user: doc.user,
        client: doc.client ?? null,
        source_kind: "document",
        source_id: doc.id,
        dept: doc.department,
        summary: docSummary,
        weight: 1.0,
        created: doc.created,
        tokens: totalTokens,
      },
    },
    ...shardTexts.map((shardText, i) => {
      const shardSummary = summaryResults[i + 1]!.summary;
      return {
        pointKey: `doc:${doc.id}:shard:${i}`,
        embedText: shardSummary || extractiveSummary(shardText),
        payload: {
          user: doc.user,
          client: doc.client ?? null,
          source_kind: "document_shard" as const,
          source_id: `${doc.id}:${i}`,
          parent_id: doc.id,
          dept: doc.department,
          summary: shardSummary || extractiveSummary(shardText),
          weight: 1.0,
          created: doc.created,
          tokens: estimateTokens(shardText),
        },
      };
    }),
  ];

  // 6. Embed in parallel. Provider is PINNED to the primary so the Qdrant
  //    collection's vector dim stays consistent across calls. Any point whose
  //    embed() falls back to the secondary provider is skipped — V4's queue
  //    will retry it when the primary recovers.
  const embedResults = await Promise.allSettled(
    targets.map((t) => embed(t.embedText, { preferProvider: PRIMARY_PROVIDER }))
  );

  // If ANY embed was rate-limited, the bucket is exhausted for this
  // invocation — bail out so the worker requeues the whole job without
  // incrementing attempts. Partial indexing here would leave Qdrant in a
  // half-state we'd have to reconcile later.
  for (const r of embedResults) {
    if (r.status === "rejected" && r.reason instanceof RateLimitedError) {
      throw r.reason;
    }
  }

  const points: QdrantPoint[] = [];
  for (let i = 0; i < targets.length; i++) {
    const r = embedResults[i]!;
    if (r.status !== "fulfilled") {
      console.warn(`[summarize] embed failed for ${targets[i]!.pointKey}:`, r.reason);
      continue;
    }
    if (r.value.provider !== PRIMARY_PROVIDER) {
      console.warn(
        `[summarize] embed used fallback provider ${r.value.provider} for ${targets[i]!.pointKey} — skipping (collection pinned to ${PRIMARY_PROVIDER})`
      );
      continue;
    }
    points.push({
      id: stableUuid(targets[i]!.pointKey),
      vector: r.value.vector,
      payload: targets[i]!.payload,
    });
  }

  if (points.length === 0) {
    return fail("all_embeddings_failed", { shards: shardTexts.length, fellBackToExtractive });
  }

  // 7. Ensure the user's Qdrant collection (per-Agency client if applicable).
  const collection = userCollection(doc.user, doc.client ?? null);
  try {
    await ensureCollection(collection, providerDim(PRIMARY_PROVIDER));
  } catch (err) {
    return fail("qdrant_ensure_failed", {
      reason: String(err),
      shards: shardTexts.length,
      fellBackToExtractive,
    });
  }

  // 8. Upsert into Qdrant.
  try {
    await upsert(collection, points);
  } catch (err) {
    return fail("qdrant_upsert_failed", {
      reason: String(err),
      shards: shardTexts.length,
      fellBackToExtractive,
    });
  }

  // 9. PATCH the documents row with summary + tokens. Non-fatal on failure —
  //    Qdrant is the source of truth for retrieval; the PB columns are for
  //    UI surfacing.
  try {
    await fetch(`${url}/api/collections/documents/records/${doc.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ summary: docSummary, tokens: totalTokens }),
    });
  } catch (err) {
    console.warn(`[summarize] documents PATCH failed for ${doc.id}:`, err);
  }

  // 10. Write one vault_embeddings_index row per Qdrant point. Idempotency is
  //     enforced by the unique index on qdrant_point_id (V1 setup).
  let indexRowsWritten = 0;
  await Promise.all(
    points.map(async (p) => {
      try {
        const res = await fetch(`${url}/api/collections/vault_embeddings_index/records`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            user: p.payload.user,
            client: p.payload.client ?? null,
            source_kind: p.payload.source_kind,
            source_id: p.payload.source_id,
            parent_id: p.payload.parent_id ?? null,
            qdrant_point_id: p.id,
            collection,
            summary: p.payload.summary,
            dept: p.payload.dept,
            weight: p.payload.weight ?? 1.0,
            tokens: p.payload.tokens,
          }),
        });
        if (res.ok) indexRowsWritten++;
      } catch {
        /* best-effort */
      }
    })
  );

  return {
    ok: true,
    documentId,
    pointsCreated: points.length,
    shards: shardTexts.length,
    fellBackToExtractive,
    durationMs: Date.now() - t0,
  };
  void indexRowsWritten; // surfaced indirectly via Qdrant point count; kept for future telemetry
  void truncated;
}
