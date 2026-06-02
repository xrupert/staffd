/**
 * vault_ingest_queue primitives.
 *
 *   enqueue(kind, sourceId)             — idempotent on source_id (V4a spec)
 *   claim(batchSize)                    — top-N pending rows whose
 *                                          next_run_at is due, marked claimed
 *   complete(rowId)                     — terminal success
 *   fail(rowId, attempts, errMessage)   — backoff or dead (spec rules)
 *   requeueNoIncrement(rowId, delaySec) — rate-limit retry path; never bumps
 *                                          the attempt counter
 *
 * PocketBase doesn't give us atomic `UPDATE … RETURNING`, so `claim` is
 * optimistic. Two overlapping worker invocations may both PATCH the same
 * row to `claimed` — downstream V3 is idempotent (`vault_embeddings_index`
 * unique on `qdrant_point_id`), so the worst case is wasted work, not a
 * correctness bug.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../pb";

export type IngestKind = "document" | "conversation" | "shard" | "backfill";
export type IngestStatus = "pending" | "claimed" | "done" | "failed" | "dead";

export type IngestRow = {
  id: string;
  kind: IngestKind;
  source_id: string;
  status: IngestStatus;
  attempts: number;
  next_run_at: string;
  last_error?: string;
  /** Phase 24 — when true, runIngestJob clears existing index rows + Qdrant
   *  points before re-running summarize+embed. Set by document edits. */
  force?: boolean;
  created: string;
  updated: string;
};

const COLLECTION = "vault_ingest_queue";

// V4a operational rules — locked.
export const MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;
const BASE_BACKOFF_MS = 30_000;

/**
 * Format a Date as the `YYYY-MM-DD HH:MM:SS` string PocketBase stores and
 * compares lexicographically. Must match the format used by `created` /
 * `updated` so filter clauses like `next_run_at<='...'` compare correctly.
 */
function pbDate(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function nowPbDate(): string {
  return pbDate(new Date());
}

function plusSecondsPbDate(seconds: number): string {
  return pbDate(new Date(Date.now() + seconds * 1000));
}

/**
 * Enqueue a source for ingestion. Idempotent by default: same `source_id`
 * returns the existing row id without inserting.
 *
 * Phase 24 — when `opts.force` is set, an existing row is FORCED back to
 * `pending` + `force:true` + `next_run_at:now`, regardless of its prior
 * terminal state (done / dead / failed). The worker reads `force` and
 * purges + re-indexes. Used by the save-edit endpoint so user edits flow
 * back into the Vault.
 */
export async function enqueue(
  kind: IngestKind,
  sourceId: string,
  opts?: { force?: boolean }
): Promise<string | null> {
  if (!sourceId) return null;
  const force = !!opts?.force;
  try {
    const token = await getAdminToken();
    const url = pbUrl();

    const existing = await pbFirst<{ id: string; status: IngestStatus }>(
      COLLECTION,
      `(source_id='${pbEscape(sourceId)}')`,
      token,
      { fields: "id,status" }
    );

    if (existing) {
      if (!force) return existing.id;
      // Force path — reactivate the row to run again with the force flag set.
      await fetch(`${url}/api/collections/${COLLECTION}/records/${existing.id}`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify({
          status: "pending",
          attempts: 0,
          next_run_at: nowPbDate(),
          force: true,
          last_error: "",
        }),
      });
      return existing.id;
    }

    const res = await fetch(`${url}/api/collections/${COLLECTION}/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        kind,
        source_id: sourceId,
        status: "pending",
        attempts: 0,
        next_run_at: nowPbDate(),
        force,
      }),
    });
    if (!res.ok) return null;
    const created = (await res.json()) as { id: string };
    return created.id;
  } catch {
    return null;
  }
}

/**
 * Claim up to `batchSize` pending rows whose `next_run_at` is in the past.
 * Marks each as `claimed`. Caller is then responsible for running the job
 * and calling `complete`, `fail`, or `requeueNoIncrement`.
 */
export async function claim(batchSize: number): Promise<IngestRow[]> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const cutoff = nowPbDate();
    const filter = `(status='pending' && next_run_at<='${cutoff}')`;
    const listRes = await fetch(
      `${url}/api/collections/${COLLECTION}/records?filter=${encodeURIComponent(filter)}&sort=next_run_at,created&perPage=${batchSize}`,
      { headers: { Authorization: token } }
    );
    if (!listRes.ok) return [];
    const data = (await listRes.json()) as { items?: IngestRow[] };
    const rows = data.items ?? [];
    if (rows.length === 0) return [];

    const claimed: IngestRow[] = [];
    await Promise.all(
      rows.map(async (row) => {
        try {
          const res = await fetch(`${url}/api/collections/${COLLECTION}/records/${row.id}`, {
            method: "PATCH",
            headers: adminHeaders(token),
            body: JSON.stringify({ status: "claimed" }),
          });
          if (res.ok) claimed.push({ ...row, status: "claimed" });
        } catch {
          /* leave row pending; next tick will re-claim */
        }
      })
    );
    return claimed;
  } catch {
    return [];
  }
}

/** Mark a row done. Terminal. */
export async function complete(rowId: string): Promise<void> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    await fetch(`${url}/api/collections/${COLLECTION}/records/${rowId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ status: "done" }),
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Record a failed attempt. Schedules exponential backoff
 * `min(30 s × 2^(attempts-1), 1 h)`. After `MAX_ATTEMPTS` (5), the row is
 * marked `dead` and surfaced in the admin dashboard.
 *
 * Returns the new status + the scheduled `next_run_at` so the worker can
 * tally the tick's outcome.
 */
export async function fail(
  rowId: string,
  attemptsSoFar: number,
  errMessage: string
): Promise<{ status: IngestStatus; nextRunAt: string; attempts: number }> {
  const newAttempts = attemptsSoFar + 1;
  const dead = newAttempts >= MAX_ATTEMPTS;
  const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, newAttempts - 1), HOUR_MS);
  const status: IngestStatus = dead ? "dead" : "pending";
  const nextRunAt = dead ? nowPbDate() : plusSecondsPbDate(Math.floor(backoffMs / 1000));

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    await fetch(`${url}/api/collections/${COLLECTION}/records/${rowId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({
        status,
        attempts: newAttempts,
        next_run_at: nextRunAt,
        last_error: errMessage.slice(0, 500),
      }),
    });
  } catch {
    /* best-effort */
  }
  return { status, nextRunAt, attempts: newAttempts };
}

/**
 * Push a rate-limited job back to `pending` with a small delay — does NOT
 * increment `attempts`. Used when the per-upstream token bucket denies a
 * call; rate limits are not the job's fault.
 */
export async function requeueNoIncrement(rowId: string, delaySec = 60): Promise<void> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    await fetch(`${url}/api/collections/${COLLECTION}/records/${rowId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({
        status: "pending",
        next_run_at: plusSecondsPbDate(delaySec),
      }),
    });
  } catch {
    /* best-effort */
  }
}

/** Count rows in a given status — used by the admin dashboard for dead-letter visibility. */
export async function countByStatus(status: IngestStatus): Promise<number> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const filter = `(status='${pbEscape(status)}')`;
    const res = await fetch(
      `${url}/api/collections/${COLLECTION}/records?filter=${encodeURIComponent(filter)}&perPage=1&fields=id`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalItems?: number };
    return data.totalItems ?? 0;
  } catch {
    return 0;
  }
}
