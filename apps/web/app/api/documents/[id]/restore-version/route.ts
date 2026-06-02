/**
 * POST /api/documents/[id]/restore-version
 * Body: { userId, pbToken, versionNumber }
 *
 * Phase 27 — Vault Editing History (restore).
 *
 * Replaces documents.output with the content of `versionNumber`, AFTER
 * snapshotting the current content as a new version (source="edit") so the
 * pre-restore state is itself recoverable. Then appends ANOTHER version
 * (source="restore", restored_from=versionNumber) carrying the same content
 * that's now live — so the version history reads as a contiguous append-only
 * timeline.
 *
 * Then fires a force re-index so the Vault embeddings match what's live.
 *
 * Auth: pbToken must own the document.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../../_lib/pb";
import { enqueue } from "../../../_lib/vault/queue";
import { appendVersion, getVersion } from "../../../_lib/vault/versions";

type RouteContext = { params: Promise<{ id: string }> };

async function loadDoc(docId: string, pbToken: string): Promise<{ user: string; output: string } | null> {
  try {
    const url = pbUrl();
    const res = await fetch(
      `${url}/api/collections/documents/records/${encodeURIComponent(docId)}`,
      { headers: { Authorization: pbToken } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: string; output?: string };
    if (!data.user) return null;
    return { user: data.user, output: data.output ?? "" };
  } catch {
    return null;
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing_doc_id" }, { status: 400 });

  let body: { userId?: string; pbToken?: string; versionNumber?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken, versionNumber } = body;
  if (!userId || !pbToken || typeof versionNumber !== "number" || versionNumber < 1) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }

  // Ownership.
  const doc = await loadDoc(id, pbToken);
  if (!doc || doc.user !== userId) {
    return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  // Resolve target version.
  const target = await getVersion(id, versionNumber);
  if (!target) {
    return Response.json({ error: "version_not_found", versionNumber }, { status: 404 });
  }

  // 1. Snapshot the CURRENT content as a pre-restore version (so the user can
  //    undo the restore). Skip if current matches target (restore is a no-op).
  let preRestoreVersion: number | null = null;
  if (doc.output !== target.content) {
    try {
      const { versionNumber: vn } = await appendVersion({
        userId,
        documentId: id,
        content: doc.output,
        source: "edit",
      });
      preRestoreVersion = vn;
    } catch (err) {
      console.error("[restore-version] pre-restore snapshot failed:", err);
      // Continue — better to restore than to fail the user's request.
    }
  }

  // 2. PATCH documents.output to the target content and clear stale fields
  //    so the worker recomputes summary + tokens.
  try {
    const adminToken = await getAdminToken();
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/documents/records/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: adminHeaders(adminToken),
      body: JSON.stringify({
        output: target.content,
        summary: null,
        tokens: null,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json({ error: "patch_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
  } catch (err) {
    return Response.json(
      { error: "patch_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // 3. Append the restore marker so the timeline reflects the restore action.
  let restoreVersion: number | null = null;
  try {
    const { versionNumber: vn } = await appendVersion({
      userId,
      documentId: id,
      content: target.content,
      source: "restore",
      restoredFrom: versionNumber,
    });
    restoreVersion = vn;
  } catch (err) {
    console.error("[restore-version] restore marker append failed:", err);
  }

  // 4. Re-index so the Vault embeddings reflect the restored content.
  const queueId = await enqueue("document", id, { force: true });

  return Response.json({
    ok: true,
    documentId: id,
    restoredFromVersion: versionNumber,
    preRestoreVersion,    // null when restore was a no-op
    restoreVersion,       // null on append failure (rare; restore still effective)
    queueId,
  });
}
