/**
 * GET /api/documents/[id]/versions
 * Query: ?userId=...&pbToken=...&withContent=false|true
 *
 * Phase 27 — Vault Editing History.
 *
 * Returns the version list for a document, newest-first. Default response
 * omits the `content` field (rows can be 100KB+ and the listing UI only
 * needs metadata). Pass `withContent=true` when rendering a version diff or
 * preview.
 *
 * Auth: pbToken must be able to read the documents row AND the documents
 * row's user must match userId. We don't trust the userId param alone.
 */

import { pbUrl } from "../../../_lib/pb";
import { listVersions } from "../../../_lib/vault/versions";

type RouteContext = { params: Promise<{ id: string }> };

async function verifyOwnership(docId: string, pbToken: string, claimedUserId: string): Promise<boolean> {
  try {
    const url = pbUrl();
    const res = await fetch(
      `${url}/api/collections/documents/records/${encodeURIComponent(docId)}`,
      { headers: { Authorization: pbToken } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { user?: string };
    return data.user === claimedUserId;
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing_doc_id" }, { status: 400 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") ?? "";
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  const withContent = url.searchParams.get("withContent") === "true";

  if (!userId || !pbToken) {
    return Response.json({ error: "missing_auth" }, { status: 401 });
  }

  if (!(await verifyOwnership(id, pbToken, userId))) {
    return Response.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  try {
    const versions = await listVersions(id, { withContent, limit: 50 });
    return Response.json({ ok: true, documentId: id, count: versions.length, versions });
  } catch (err) {
    return Response.json(
      { error: "list_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
