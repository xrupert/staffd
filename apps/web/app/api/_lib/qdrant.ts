/**
 * Minimal Qdrant client — only the operations the Vault uses.
 *
 *   - ensureCollection(name, dim)  — create-if-missing, idempotent
 *   - upsert(name, points)         — insert/update vectors with payload
 *   - search(name, vector, opts)   — top-K cosine similarity
 *
 * Auth via `api-key` header. Self-hosted on Railway per spec §6.
 *
 * Naming conventions used by the Vault:
 *   collection: `vault_{userId}` (or `vault_{userId}__{clientId}` for Agency)
 *   point.id:    deterministic UUID-like string derived from source_kind+source_id
 */

const QDRANT_URL = (process.env.QDRANT_URL ?? "").replace(/\/$/, "");
const QDRANT_KEY = process.env.QDRANT_API_KEY ?? "";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "api-key": QDRANT_KEY,
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
}

function assertConfigured(): void {
  if (!QDRANT_URL) throw new Error("QDRANT_URL not set");
  if (!QDRANT_KEY) throw new Error("QDRANT_API_KEY not set");
}

export type QdrantPayload = {
  user: string;
  client?: string | null;
  source_kind: "document" | "document_shard" | "conversation" | "pattern";
  source_id: string;
  parent_id?: string;
  dept?: string;
  summary?: string;
  weight?: number;
  created?: string; // ISO
  tokens?: number;
};

export type QdrantPoint = {
  id: string;
  vector: number[];
  payload: QdrantPayload;
};

export type QdrantSearchHit = {
  id: string;
  score: number; // cosine in [0,1] after normalization (Qdrant returns raw cosine in [-1,1] but for normalized vectors it's in [0,1])
  payload: QdrantPayload;
};

/**
 * Returns true if the named collection exists. Distinct from ensure() so
 * callers can branch (e.g. retrieve() returns [] rather than auto-creating).
 */
export async function collectionExists(name: string): Promise<boolean> {
  assertConfigured();
  const res = await fetch(`${QDRANT_URL}/collections/${encodeURIComponent(name)}`, {
    headers: authHeaders(),
  });
  return res.ok;
}

/** Create the collection if missing. Vector size and Cosine distance locked. */
export async function ensureCollection(name: string, dim: number): Promise<void> {
  assertConfigured();
  const existsRes = await fetch(`${QDRANT_URL}/collections/${encodeURIComponent(name)}`, {
    headers: authHeaders(),
  });
  if (existsRes.ok) return;

  const createRes = await fetch(`${QDRANT_URL}/collections/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      vectors: { size: dim, distance: "Cosine" },
    }),
  });
  if (!createRes.ok && createRes.status !== 409) {
    const detail = await createRes.text();
    throw new Error(`Qdrant create collection ${name} failed (${createRes.status}): ${detail.slice(0, 300)}`);
  }
}

/** Upsert points. Caller is responsible for ID stability + vector dimension. */
export async function upsert(name: string, points: QdrantPoint[]): Promise<void> {
  assertConfigured();
  if (points.length === 0) return;
  const res = await fetch(
    `${QDRANT_URL}/collections/${encodeURIComponent(name)}/points?wait=true`,
    {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ points }),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Qdrant upsert ${name} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/**
 * Cosine search. Returns up to `limit` hits ordered by descending score.
 *
 * Optional payload filter — supports the small subset we use (dept equality,
 * client equality). Pass null / omit fields to skip a clause.
 */
export async function search(
  name: string,
  vector: number[],
  opts: {
    limit: number;
    dept?: string;
    client?: string | null;
  }
): Promise<QdrantSearchHit[]> {
  assertConfigured();

  const must: Array<Record<string, unknown>> = [];
  if (opts.dept) must.push({ key: "dept", match: { value: opts.dept } });
  if (opts.client !== undefined) must.push({ key: "client", match: { value: opts.client } });

  const body: Record<string, unknown> = {
    vector,
    limit: opts.limit,
    with_payload: true,
  };
  if (must.length) body.filter = { must };

  const res = await fetch(
    `${QDRANT_URL}/collections/${encodeURIComponent(name)}/points/search`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }
  );

  if (res.status === 404) return []; // collection not yet created
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Qdrant search ${name} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { result?: QdrantSearchHit[] };
  return data.result ?? [];
}

/**
 * Update payload fields on one or more existing points. Used by pattern
 * tracking (V6) to bump a doc's `weight` after the user shares / publishes
 * the artifact — re-embedding would be wasteful since the vector itself
 * doesn't change.
 *
 * Qdrant supports merge semantics via the points/payload endpoint:
 * existing keys are overwritten with the values in `payload`, other keys
 * are left intact.
 */
export async function setPayload(
  name: string,
  pointIds: string[],
  payload: Partial<QdrantPayload>
): Promise<void> {
  assertConfigured();
  if (pointIds.length === 0) return;
  const res = await fetch(
    `${QDRANT_URL}/collections/${encodeURIComponent(name)}/points/payload?wait=true`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ payload, points: pointIds }),
    }
  );
  if (!res.ok && res.status !== 404) {
    const detail = await res.text();
    throw new Error(`Qdrant setPayload ${name} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/**
 * Delete one or more points by id. Used by Phase 24's force-re-index flow
 * when a document is edited and the stale embedding must be purged before
 * the new summary is upserted.
 *
 * Tolerates a missing collection (404) and non-existent point ids — both
 * cases are treated as success since the desired end state is "those points
 * don't exist."
 */
export async function deletePoints(name: string, pointIds: string[]): Promise<void> {
  assertConfigured();
  if (pointIds.length === 0) return;
  const res = await fetch(
    `${QDRANT_URL}/collections/${encodeURIComponent(name)}/points/delete?wait=true`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ points: pointIds }),
    }
  );
  if (!res.ok && res.status !== 404) {
    const detail = await res.text();
    throw new Error(`Qdrant deletePoints ${name} failed (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/** Compose the per-user collection name. Agency mode appends the client id. */
export function userCollection(userId: string, clientId?: string | null): string {
  return clientId ? `vault_${userId}__${clientId}` : `vault_${userId}`;
}
