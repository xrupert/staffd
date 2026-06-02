/**
 * POST /api/vault/patterns
 *
 * Record a "successful pattern" signal for a document. The pattern is logged
 * to `vault_patterns` and the source's retrieval weight is bumped — so the
 * next time `retrieve()` surfaces related work, this doc outranks neutral
 * memory by the configured pattern weight (V6 spec).
 *
 * Body:
 *   { documentId: string, signal: "kept"|"shared"|"published"|"regenerated", pbToken: string, clientId?: string }
 *
 * Auth: pbToken is used to verify the caller can read the document. PB row
 * rules enforce visibility — same pattern as /api/vault/enqueue.
 *
 * Returns: { ok, weight, indexRowsUpdated, qdrantPointsUpdated } on success,
 * 4xx envelope on validation or ownership failures.
 */

import { pbUrl } from "../../_lib/pb";
import { recordPattern, VALID_SIGNALS, type PatternSignal } from "../../_lib/vault/patterns";

export async function POST(req: Request) {
  let body: {
    documentId?: string;
    signal?: string;
    pbToken?: string;
    clientId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { documentId, signal, pbToken, clientId } = body;
  if (!documentId || !signal || !pbToken) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!VALID_SIGNALS.has(signal as PatternSignal)) {
    return Response.json({ error: "invalid_signal" }, { status: 400 });
  }

  // Ownership check — must be able to fetch the doc with the caller's token.
  let url: string;
  try {
    url = pbUrl();
  } catch {
    return Response.json({ error: "pb_not_configured" }, { status: 503 });
  }

  let userId = "";
  try {
    const docRes = await fetch(
      `${url}/api/collections/documents/records/${encodeURIComponent(documentId)}`,
      { headers: { Authorization: pbToken } }
    );
    if (!docRes.ok) {
      return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });
    }
    const doc = (await docRes.json()) as { user?: string };
    userId = doc.user ?? "";
  } catch {
    return Response.json({ error: "verify_failed" }, { status: 500 });
  }

  if (!userId) {
    return Response.json({ error: "document_missing_user" }, { status: 500 });
  }

  const result = await recordPattern({
    userId,
    documentId,
    signal: signal as PatternSignal,
    clientId: clientId ?? null,
  });

  return Response.json(result);
}
