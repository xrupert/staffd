/**
 * Idempotent setup for the Vault Phase 2 collections.
 *
 * Creates / migrates four pieces of schema in one place so the Vault ingestion
 * pipeline (V4) and the orchestrator's retrieval guardrails (V2) have stable
 * ground to stand on. Spec §13 / §17 #2.
 *
 *  1. documents (augment) — `summary` (text, ≤600 chars) + `tokens` (number)
 *  2. vault_embeddings_index — one row per embedded artifact, denormalized
 *     summary alongside qdrant_point_id for fast retrieval without a second
 *     fetch.
 *  3. vault_patterns — kept/shared/published/regenerated signals that bump
 *     retrieval weight on the source document.
 *  4. vault_retrieval_metrics — one row per retrieve() call; daily worker
 *     rollups p95 per user.
 *
 * Safe to re-run.
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

type FieldDef = { name: string; type: string; required?: boolean };

const DOCUMENTS_AUGMENT: FieldDef[] = [
  { name: "summary", type: "text",   required: false }, // ≤600 chars
  { name: "tokens",  type: "number", required: false },
  // W62 — validated, threshold-gated platform-action candidates
  // ([{id, confidence, reason, params?}]) written by /api/handoff/suggest.
  { name: "action_candidates", type: "json", required: false },
];

const EMBEDDINGS_INDEX_FIELDS: FieldDef[] = [
  { name: "user",            type: "text",   required: true  },
  { name: "client",          type: "text",   required: false },
  { name: "source_kind",     type: "text",   required: true  }, // document|document_shard|conversation|pattern
  { name: "source_id",       type: "text",   required: true  }, // PB id of the source record
  { name: "parent_id",       type: "text",   required: false }, // for shards: id of the document_shard's parent document
  { name: "qdrant_point_id", type: "text",   required: true  },
  { name: "collection",      type: "text",   required: false }, // qdrant collection name
  { name: "summary",         type: "text",   required: false }, // denormalised, ≤600 chars
  { name: "dept",            type: "text",   required: false },
  { name: "weight",          type: "number", required: false }, // 1.0 default; 2.0 for kept/shared patterns
  { name: "tokens",          type: "number", required: false },
];

const PATTERNS_FIELDS: FieldDef[] = [
  { name: "user",        type: "text", required: true  },
  { name: "client",      type: "text", required: false },
  { name: "document_id", type: "text", required: true  },
  { name: "signal",      type: "text", required: true  }, // kept|shared|published|regenerated
];

const RETRIEVAL_METRICS_FIELDS: FieldDef[] = [
  { name: "user",            type: "text",   required: true  },
  { name: "intent",          type: "text",   required: false }, // route|handoff|brief|synthesize
  { name: "latency_ms",      type: "number", required: false },
  { name: "items_returned",  type: "number", required: false },
  { name: "tokens_returned", type: "number", required: false },
  { name: "cost_flag",       type: "text",   required: false }, // ok|trimmed|degraded
];

// Phase 5 — vault_decisions: events / decisions / outcomes that don't map
// cleanly to a single document but DO inform CEO synthesis (closed deal,
// signed contract, booked meeting, strategic call). Pattern-style outcomes
// (engagement, conversion, bounce) still flow through vault_patterns; this
// is the "things happened" table.
const DECISIONS_FIELDS: FieldDef[] = [
  { name: "user",          type: "text",   required: true  },
  { name: "client",        type: "text",   required: false }, // Agency scope
  { name: "decision_kind", type: "text",   required: true  }, // contract_signed | deal_closed | meeting_booked | content_published | strategic | manual | ...
  { name: "title",         type: "text",   required: true  }, // human summary
  { name: "source_kind",   type: "text",   required: false }, // docuseal | twenty | listmonk | plausible | manual
  { name: "source_id",     type: "text",   required: false }, // external id from the source system
  { name: "document_id",   type: "text",   required: false }, // optional link back to a STAFFD artifact
  { name: "scope",         type: "json",   required: false }, // { dept?, topic?, tags? }
  { name: "impact",        type: "json",   required: false }, // { metric?, value?, currency? }
  { name: "expires_at",    type: "text",   required: false }, // for time-bounded decisions
  { name: "dismissed",     type: "bool",   required: false },
];

async function getAdminToken(pbUrl: string): Promise<string> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error("Admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function augmentCollection(
  pbUrl: string,
  token: string,
  name: string,
  newFields: FieldDef[]
): Promise<{ action: "noop" | "patched"; added: string[] }> {
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const colRes = await fetch(`${pbUrl}/api/collections/${name}`, {
    headers: { Authorization: token },
  });
  if (!colRes.ok) throw new Error(`Collection ${name} does not exist — cannot augment`);

  const col = (await colRes.json()) as {
    id: string;
    fields?: Array<{ name: string }>;
  };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = newFields.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop", added: [] };

  const allFields = [...(col.fields ?? []), ...missing];
  const patchRes = await fetch(`${pbUrl}/api/collections/${col.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: allFields }),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    throw new Error(`Failed to patch ${name}: ${detail}`);
  }
  return { action: "patched", added: missing.map((f) => f.name) };
}

async function ensureCollection(
  pbUrl: string,
  token: string,
  name: string,
  fields: FieldDef[],
  indexes?: string[]
): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const colRes = await fetch(`${pbUrl}/api/collections/${name}`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, type: "base", fields, ...(indexes ? { indexes } : {}) }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create ${name}: ${detail}`);
    }
    return { action: "created" };
  }

  const col = (await colRes.json()) as {
    id: string;
    fields?: Array<{ name: string }>;
  };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = fields.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" };

  const allFields = [...(col.fields ?? []), ...missing];
  const patchRes = await fetch(`${pbUrl}/api/collections/${col.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: allFields }),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    throw new Error(`Failed to patch ${name}: ${detail}`);
  }
  return { action: "patched", added: missing.map((f) => f.name) };
}

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const url = pbUrl.replace(/\/$/, "");
  try {
    const token = await getAdminToken(url);

    const documents = await augmentCollection(url, token, "documents", DOCUMENTS_AUGMENT);
    const embeddingsIndex = await ensureCollection(url, token, "vault_embeddings_index", EMBEDDINGS_INDEX_FIELDS, [
      "CREATE UNIQUE INDEX idx_vei_qpoint ON vault_embeddings_index (qdrant_point_id)",
      "CREATE INDEX idx_vei_user_kind ON vault_embeddings_index (user, source_kind)",
      "CREATE INDEX idx_vei_source ON vault_embeddings_index (source_id)",
    ]);
    const patterns = await ensureCollection(url, token, "vault_patterns", PATTERNS_FIELDS, [
      // PB rejects (user, created) at create-time — drop it; default sort works.
      "CREATE INDEX idx_vp_doc ON vault_patterns (document_id)",
    ]);
    const metrics = await ensureCollection(url, token, "vault_retrieval_metrics", RETRIEVAL_METRICS_FIELDS, [
      // PB rejects (user, created) at create-time — drop it; default sort works.
    ]);
    const decisions = await ensureCollection(url, token, "vault_decisions", DECISIONS_FIELDS, [
      // PB rejects (user, created) at create-time — drop it; default sort works.
      "CREATE INDEX idx_vd_user_kind ON vault_decisions (user, decision_kind)",
      "CREATE INDEX idx_vd_doc ON vault_decisions (document_id)",
    ]);

    // Decision 69 — enforce row rules on every collection this setup touches.
    const rules = {
      documents: (await ensureCollectionRulesWithFreshToken("documents")).status,
      vault_embeddings_index: (await ensureCollectionRulesWithFreshToken("vault_embeddings_index")).status,
      vault_patterns: (await ensureCollectionRulesWithFreshToken("vault_patterns")).status,
      vault_retrieval_metrics: (await ensureCollectionRulesWithFreshToken("vault_retrieval_metrics")).status,
      vault_decisions: (await ensureCollectionRulesWithFreshToken("vault_decisions")).status,
    };

    return Response.json({
      ok: true,
      documents,
      vault_embeddings_index: embeddingsIndex,
      vault_patterns: patterns,
      vault_retrieval_metrics: metrics,
      vault_decisions: decisions,
      rules,
    });
  } catch (err) {
    console.error("Vault setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
