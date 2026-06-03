/**
 * Idempotent setup for the `vault_ingest_queue` collection.
 *
 *   kind         — document | conversation | shard | backfill
 *   source_id    — PB id of the artifact being ingested (unique)
 *   status       — pending | claimed | done | failed | dead
 *   attempts     — int, incremented only on real failures (not rate limits)
 *   next_run_at  — earliest datetime this row may be claimed
 *   last_error   — last failure message (≤ 500 chars)
 *
 * Indexes: status+next_run_at (worker claim path), source_id unique
 * (V4a idempotency contract).
 */

const REQUIRED_FIELDS = [
  { name: "kind",        type: "text",   required: true  },
  { name: "source_id",   type: "text",   required: true  },
  { name: "status",      type: "text",   required: false },
  { name: "attempts",    type: "number", required: false },
  { name: "next_run_at", type: "text",   required: false },
  { name: "last_error",  type: "text",   required: false },
  // Phase 24 — when true, the ingest worker DELETES existing
  // vault_embeddings_index rows + Qdrant points for this source_id BEFORE
  // re-running summarize+embed. Used when a user edits a draft and the
  // memory needs to reflect the new content.
  { name: "force",       type: "bool",   required: false },
];

const INDEXES = [
  "CREATE INDEX idx_viq_status_next_run ON vault_ingest_queue (status, next_run_at)",
  "CREATE UNIQUE INDEX idx_viq_source ON vault_ingest_queue (source_id)",
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

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

async function ensureCollection(pbUrl: string) {
  const token = await getAdminToken(pbUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };

  const colRes = await fetch(`${pbUrl}/api/collections/vault_ingest_queue`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "vault_ingest_queue",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: INDEXES,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create vault_ingest_queue: ${detail}`);
    }
    return { action: "created" as const };
  }

  const col = (await colRes.json()) as {
    id: string;
    fields?: Array<{ name: string }>;
  };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" as const };

  const allFields = [...(col.fields ?? []), ...missing];
  const patchRes = await fetch(`${pbUrl}/api/collections/${col.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: allFields }),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    throw new Error(`Failed to patch vault_ingest_queue: ${detail}`);
  }
  return { action: "patched" as const, added: missing.map((f) => f.name) };
}

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const result = await ensureCollection(pbUrl.replace(/\/$/, ""));
    // Decision 69 — enforce row rules from the canonical registry.
    const rules = await ensureCollectionRulesWithFreshToken("vault_ingest_queue");
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error("Vault queue setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
