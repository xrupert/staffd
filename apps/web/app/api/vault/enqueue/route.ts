/**
 * POST /api/vault/enqueue
 *
 * Client-callable enqueue for the Vault ingestion pipeline. Frontend code
 * calls this fire-and-forget after creating a `documents` (or, in V5,
 * `conversations`) row so the V4a worker picks it up on the next minute's
 * cron tick.
 *
 * Auth: the caller passes their PocketBase session token; we use it to fetch
 * the artifact and confirm visibility before enqueuing. If a user can read
 * the artifact, they're allowed to ingest it. (The artifact's `user` field
 * determines whose vault gets the embedding — there's no leakage risk from
 * enqueueing someone else's id; the worker will index it against the real
 * owner.)
 *
 * Body:
 *   { docId:  string, pbToken: string }                    — kind="document"
 *   { turnId: string, pbToken: string, kind:"conversation" } — V5 callers
 *
 * Returns: { ok:true, queueId } on success, or a 4xx error envelope.
 *
 * Idempotency is provided by `enqueue()` (V4a) — calling this twice for the
 * same artifact returns the existing queue row id.
 */

import { enqueue, type IngestKind } from "../../_lib/vault/queue";
import { pbUrl } from "../../_lib/pb";

export async function POST(req: Request) {
  let body: {
    docId?: string;
    turnId?: string;
    kind?: string;
    pbToken?: string;
    // Phase 24 — when true, the queue marks this for a force re-index
    // (purges existing embeddings + Qdrant points before re-running).
    force?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const kind: IngestKind = body.kind === "conversation" ? "conversation" : "document";
  const id = kind === "document" ? body.docId : body.turnId;
  const pbToken = body.pbToken;
  const force = !!body.force;

  if (!id || !pbToken) {
    return Response.json({ error: "missing_id_or_token" }, { status: 400 });
  }

  // Ownership check — fetch the artifact with the caller's token. PB row
  // rules enforce visibility; we don't need to inspect the body.
  let url: string;
  try {
    url = pbUrl();
  } catch {
    return Response.json({ error: "pb_not_configured" }, { status: 503 });
  }

  const collection = kind === "document" ? "documents" : "conversations";
  try {
    const res = await fetch(
      `${url}/api/collections/${collection}/records/${encodeURIComponent(id)}`,
      { headers: { Authorization: pbToken } }
    );
    if (!res.ok) {
      return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });
    }
  } catch {
    return Response.json({ error: "verify_failed" }, { status: 500 });
  }

  const queueId = await enqueue(kind, id, { force });
  if (!queueId) {
    return Response.json({ error: "enqueue_failed" }, { status: 500 });
  }
  return Response.json({ ok: true, queueId, force });
}
