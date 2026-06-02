/**
 * POST /api/documents/[id]/save-edit
 * Body: { userId, pbToken, content }
 *
 * Phase 24 — Live Draft Editing.
 *
 * Saves an edited draft back to the documents collection and re-indexes it
 * in the Vault so the edited content replaces the stale embedding.
 *
 * Flow:
 *   1. Verify the caller owns the document (PB row rules via pbToken).
 *   2. PATCH documents.output (clears the stored summary + tokens so the
 *      worker recomputes them).
 *   3. Fire enqueue("document", id, {force:true}) so the V4a worker purges
 *      existing index rows + Qdrant points before re-running summarize+embed.
 *
 * The re-index is async (next worker tick, typically within 60s). The
 * response returns immediately so the UI feels snappy.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../../_lib/pb";
import { enqueue } from "../../../_lib/vault/queue";
import { appendVersion } from "../../../_lib/vault/versions";

type RouteContext = { params: Promise<{ id: string }> };

async function verifyDocOwnership(
  docId: string,
  pbToken: string,
): Promise<{ ok: true; userId: string; currentContent: string } | { ok: false }> {
  try {
    const url = pbUrl();
    const res = await fetch(
      `${url}/api/collections/documents/records/${encodeURIComponent(docId)}`,
      { headers: { Authorization: pbToken } }
    );
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { user?: string; output?: string };
    if (!data.user) return { ok: false };
    return { ok: true, userId: data.user, currentContent: data.output ?? "" };
  } catch {
    return { ok: false };
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing_doc_id" }, { status: 400 });

  let body: { userId?: string; pbToken?: string; content?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken, content } = body;
  if (!userId || !pbToken || typeof content !== "string") {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (content.length > 200_000) {
    return Response.json({ error: "content_too_large" }, { status: 413 });
  }

  // Ownership check — the doc must be visible via the caller's pbToken AND
  // the doc.user must match the claimed userId.
  const ownership = await verifyDocOwnership(id, pbToken);
  if (!ownership.ok || ownership.userId !== userId) {
    return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  // Phase 27 — snapshot the CURRENT content as a new version BEFORE we
  // overwrite. If this is the first save, the "current" content is whatever
  // the worker first produced, so version 1 captures the original draft.
  // Skip the snapshot when the new content matches the current content
  // (no-op edit — common when the user opens the editor and clicks Save
  // without changes).
  let snapshotVersion: number | null = null;
  if (ownership.currentContent && ownership.currentContent !== content) {
    try {
      const { versionNumber } = await appendVersion({
        userId,
        documentId: id,
        content: ownership.currentContent,
        source: "edit",
      });
      snapshotVersion = versionNumber;
    } catch (err) {
      // Versioning failure should not block the save — log + proceed.
      // The user's edit still persists; only the history is missing.
      console.error("[save-edit] appendVersion failed:", err);
    }
  }

  // PATCH the document with new content + clear stale summary/tokens.
  try {
    const adminToken = await getAdminToken();
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/documents/records/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: adminHeaders(adminToken),
      body: JSON.stringify({
        output: content,
        // Null these so the next worker pass writes fresh values.
        summary: null,
        tokens: null,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json({ error: "patch_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
  } catch (err) {
    return Response.json({ error: "patch_failed", detail: String(err) }, { status: 500 });
  }

  // Fire-and-forget re-index. Worker picks up next minute.
  const queueId = await enqueue("document", id, { force: true });

  return Response.json({
    ok: true,
    queueId,
    snapshotVersion, // null when no snapshot was created (no-op edit)
    action: "saved_and_reindex_queued",
  });
}
