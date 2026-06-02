/**
 * Phase 27 — Vault Editing History helpers.
 *
 * Append-only versioning over the `document_versions` PB collection. The
 * authoritative content always lives on the `documents` row's `output` field;
 * versions are snapshots for audit + restore. Reasoning:
 *
 *   • Vault retrieval + summary already key off `documents.output` — so
 *     keeping that as the source-of-truth means no other code path needs to
 *     change. Restore is just "snapshot current → copy old version's content
 *     onto documents.output → re-index".
 *   • Append-only means the history is the version_number sequence (1, 2, 3,
 *     …). Restoring version N appends N+1 with the same content + source set
 *     to "restore" + restored_from=N. Nothing is ever destroyed.
 *
 * This file uses admin auth (not pbToken) because version writes need to
 * insert rows even when called from server-side worker contexts. Ownership
 * is enforced at the route level before calling these helpers.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../pb";

export type VersionSource = "edit" | "restore" | "regenerate";

export type DocumentVersion = {
  id: string;
  user: string;
  document: string;
  version_number: number;
  content: string;
  char_count: number;
  source: VersionSource;
  restored_from?: number;
  created: string;
};

/**
 * Returns the highest version_number for a document, or 0 if no versions yet.
 * Implemented as a sorted=-version_number list of 1; PB will scan the unique
 * index so this is cheap.
 */
export async function getLatestVersionNumber(documentId: string): Promise<number> {
  const token = await getAdminToken();
  const url = pbUrl();
  const filter = encodeURIComponent(`document='${documentId}'`);
  const res = await fetch(
    `${url}/api/collections/document_versions/records?filter=${filter}&sort=-version_number&perPage=1&fields=version_number`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return 0;
  const data = (await res.json()) as { items?: Array<{ version_number?: number }> };
  return data.items?.[0]?.version_number ?? 0;
}

/**
 * Insert a new version row. Returns the assigned version_number on success.
 * Idempotency note: caller must serialize concurrent saves on the same doc;
 * the unique (document, version_number) index will reject collisions which
 * surface here as a thrown error. In practice the save-edit endpoint is
 * called from a single user's browser so contention is essentially zero.
 */
export async function appendVersion(opts: {
  userId: string;
  documentId: string;
  content: string;
  source: VersionSource;
  restoredFrom?: number;
}): Promise<{ versionNumber: number; id: string }> {
  const { userId, documentId, content, source, restoredFrom } = opts;
  const latest = await getLatestVersionNumber(documentId);
  const versionNumber = latest + 1;

  const token = await getAdminToken();
  const url = pbUrl();
  const body: Record<string, unknown> = {
    user: userId,
    document: documentId,
    version_number: versionNumber,
    content,
    char_count: content.length,
    source,
  };
  if (typeof restoredFrom === "number") body.restored_from = restoredFrom;

  const res = await fetch(`${url}/api/collections/document_versions/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`appendVersion failed: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return { versionNumber, id: data.id };
}

/**
 * Returns versions for a document, newest-first. The `content` field can be
 * large — callers that only need metadata should pass `withContent: false`.
 */
export async function listVersions(
  documentId: string,
  opts: { withContent?: boolean; limit?: number } = {},
): Promise<DocumentVersion[]> {
  const { withContent = false, limit = 50 } = opts;
  const token = await getAdminToken();
  const url = pbUrl();
  const filter = encodeURIComponent(`document='${documentId}'`);
  const fields = withContent
    ? "id,user,document,version_number,content,char_count,source,restored_from,created"
    : "id,user,document,version_number,char_count,source,restored_from,created";
  const res = await fetch(
    `${url}/api/collections/document_versions/records?filter=${filter}&sort=-version_number&perPage=${limit}&fields=${fields}`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: DocumentVersion[] };
  return (data.items ?? []).map((v) => ({
    ...v,
    content: v.content ?? "",
    char_count: v.char_count ?? 0,
  }));
}

/**
 * Fetch a single version's full content.
 */
export async function getVersion(
  documentId: string,
  versionNumber: number,
): Promise<DocumentVersion | null> {
  const token = await getAdminToken();
  const url = pbUrl();
  const filter = encodeURIComponent(`document='${documentId}' && version_number=${versionNumber}`);
  const res = await fetch(
    `${url}/api/collections/document_versions/records?filter=${filter}&perPage=1`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: DocumentVersion[] };
  return data.items?.[0] ?? null;
}
