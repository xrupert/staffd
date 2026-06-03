/**
 * Idempotent setup for `document_versions` (Phase 27 — Vault Editing History).
 *
 * One row per save. Lets the user audit prior versions of any document they've
 * edited and restore an earlier version if they want to roll back. Restore
 * itself creates a NEW version row — versioning is append-only.
 *
 * Schema:
 *   • user            — owner (denormalized for fast per-user queries)
 *   • document        — id of the documents row this version belongs to
 *   • version_number  — monotonic per-document (1, 2, 3, …)
 *   • content         — the full text of this version (no diffing — disk is cheap)
 *   • char_count      — quick stat for the UI (avoids re-measuring on the client)
 *   • source          — "edit" | "restore" | "regenerate" — origin of this version
 *   • restored_from   — when source="restore", the version_number that was restored
 *   • created         — auto-managed by PB
 *
 * Indexes:
 *   • (document, version_number) UNIQUE — guarantees monotonic numbering
 *   • (user, created)            — fastest path for "recent activity" admin views
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const REQUIRED_FIELDS = [
  { name: "user",           type: "text",   required: true  },
  { name: "document",       type: "text",   required: true  },
  { name: "version_number", type: "number", required: true  },
  { name: "content",        type: "text",   required: false },
  { name: "char_count",     type: "number", required: false },
  { name: "source",         type: "text",   required: false }, // edit | restore | regenerate
  { name: "restored_from",  type: "number", required: false },
];

// Hotfix B1 — PB rejects indexes that reference the autodate `created`
// column at collection-create time ("no such column: created"), because the
// column isn't materialized until after the collection exists. We only
// pre-create the unique constraint here; PB auto-uses `created` in ORDER BY
// without an explicit index for typical scan volumes.
const INDEXES = [
  "CREATE UNIQUE INDEX idx_dv_doc_version ON document_versions (document, version_number)",
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

async function ensureCollection(pbUrl: string) {
  const token = await getAdminToken(pbUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };

  const colRes = await fetch(`${pbUrl}/api/collections/document_versions`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "document_versions",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: INDEXES,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create document_versions: ${detail}`);
    }
    return { action: "created" as const };
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
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
    throw new Error(`Failed to patch document_versions: ${detail}`);
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
    const rules = await ensureCollectionRulesWithFreshToken("document_versions");
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error("Document versions setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
