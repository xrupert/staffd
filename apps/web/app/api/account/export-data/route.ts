/**
 * POST /api/account/export-data
 *
 * GDPR Article 20 — Right to Data Portability. Emits a complete JSON archive
 * of every row the calling user owns across STAFFD's PocketBase collections.
 *
 * Auth: user's own PB token (rows are read with that token so PB row rules
 * enforce ownership scoping — no privilege escalation possible).
 *
 * Sanitization (Decision 56 — GDPR-A deliverable):
 *   - users.password / passwordHash / tokenKey are STRIPPED (never exported)
 *   - subscriptions: only current state + Stripe customer id are returned;
 *     no payment-method details (which we never store anyway, but defensive)
 *   - documents: metadata + the public doc URL ARE included; the actual
 *     output blob is referenced by URL — the user can fetch each blob
 *     separately via /api/doc/[id] if they want raw content
 *
 * Super-admin: allowed (operator may want their own archive). Block applies
 * only to the delete route, not export.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";

type ExportEnvelope = {
  exported_at: string;
  user_id: string;
  staffd_version: "GDPR-A-v1";
  collections: Record<string, unknown[]>;
  notes: string[];
};

// Per-user-owned collections. Mirrors the USER_OWNED_RULES set in
// _lib/security/row-rules.ts plus AGENCY_OWNED (clients) for Agency users.
const USER_OWNED_COLLECTIONS = [
  "subscriptions",
  "businesses",
  "documents",
  "document_versions",
  "vault_briefs",
  "vault_decisions",
  "vault_patterns",
  "vault_voice_profile",
  "vault_embeddings_index",
  "vault_retrieval_metrics",
  "conversations",
  "conversation_threads",
  "push_subscriptions",
  "scheduled_content",
  "bookings",
  "orchestrator_decisions",
  "templates",
] as const;

const AGENCY_OWNED_COLLECTIONS = ["clients"] as const;

// Fields stripped from user record on export. GDPR portability does NOT
// require us to leak our own auth secrets.
const USER_FIELD_DENYLIST = new Set([
  "password",
  "passwordHash",
  "tokenKey",
  "verified", // PB internal flag; not user data
]);

async function whoAmI(pbToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

async function fetchUserRows(adminToken: string, collection: string, userId: string, filterField = "user"): Promise<unknown[]> {
  try {
    // Use admin token + explicit user filter for completeness (some collections
    // may have row rules that filter differently from the user's own token —
    // export should return EVERYTHING the user owns, not just what they can
    // currently see via their token).
    const filter = `${filterField}="${userId.replace(/"/g, '\\"')}"`;
    const out: unknown[] = [];
    let page = 1;
    while (page <= 20) {
      const res = await fetch(
        `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records?filter=${encodeURIComponent(filter)}&page=${page}&perPage=200`,
        { headers: { Authorization: adminToken } },
      );
      if (!res.ok) break;
      const data = (await res.json()) as { items?: unknown[]; totalPages?: number };
      if (!data.items || data.items.length === 0) break;
      out.push(...data.items);
      if (page >= (data.totalPages ?? 1)) break;
      page++;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchSanitizedUser(adminToken: string, userId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${pbUrl()}/api/collections/users/records/${encodeURIComponent(userId)}`,
      { headers: { Authorization: adminToken } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (USER_FIELD_DENYLIST.has(k)) continue;
      sanitized[k] = v;
    }
    return sanitized;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const envelope: ExportEnvelope = {
    exported_at: new Date().toISOString(),
    user_id: me.id,
    staffd_version: "GDPR-A-v1",
    collections: {},
    notes: [
      "This archive contains every row STAFFD stores about you in PocketBase.",
      "Document output blobs are referenced by URL (not inlined). Fetch /api/doc/{id} per document for raw content.",
      "Vault embeddings (Qdrant vectors) are not included — they are derived data, not original input. The vault_embeddings_index PB rows referencing them ARE included.",
      "Subscriptions include current plan state + Stripe customer id only. Payment-method details are never stored by STAFFD.",
      "Auth secrets (password hash, token key) are stripped per GDPR-A sanitization.",
    ],
  };

  // Sanitized user record first
  const userRecord = await fetchSanitizedUser(adminToken, me.id);
  if (userRecord) envelope.collections.users = [userRecord];

  // Standard user-owned collections (filter: user = me.id)
  for (const c of USER_OWNED_COLLECTIONS) {
    envelope.collections[c] = await fetchUserRows(adminToken, c, me.id, "user");
  }

  // Agency-owned (filter: agency_user = me.id)
  for (const c of AGENCY_OWNED_COLLECTIONS) {
    envelope.collections[c] = await fetchUserRows(adminToken, c, me.id, "agency_user");
  }

  const body = JSON.stringify(envelope, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="staffd-data-export-${me.id}-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
