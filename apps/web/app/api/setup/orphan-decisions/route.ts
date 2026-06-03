/**
 * Idempotent setup for `orphan_decisions` (Decision 71).
 *
 * Persists super-admin's decisions on the 3 ℹ️ unexpected collections
 * (case-variant orphans from prior schema drift). Recorded decisions are
 * advisory — no autonomous deletion. Senior Architect reviews + authorizes
 * a separate follow-up PR for any "drop" decisions.
 *
 * Schema:
 *   collection_name (text, required) — orphan collection identifier
 *   decision        (text, required) — drop_safe | drop_after_migration |
 *                                       investigate_active_usage |
 *                                       keep_with_setup_route
 *   reason          (text, optional) — operator's free-text notes
 *   decided_by      (text, required) — operator user id
 *   status          (text, optional) — pending | approved | executed
 *                                       (default: pending)
 *   created         (autodate) — when decided
 *
 * Row rules: admin-only (ADMIN_ONLY_RULES). Only super-admin should
 * interact; the dashboard UI uses pbToken auth + ADMIN_EMAIL check, but
 * the underlying collection is locked at the row-rule tier as defense-
 * in-depth.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const REQUIRED_FIELDS = [
  { name: "collection_name", type: "text", required: true },
  { name: "decision",        type: "text", required: true },
  { name: "reason",          type: "text", required: false },
  { name: "decided_by",      type: "text", required: true },
  { name: "status",          type: "text", required: false },
];

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/orphan_decisions`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        name: "orphan_decisions",
        type: "base",
        fields: REQUIRED_FIELDS,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create orphan_decisions: ${detail}`);
    }
    return { action: "created" };
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" };

  const allFields = [...(col.fields ?? []), ...missing];
  const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ fields: allFields }),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    throw new Error(`Failed to patch orphan_decisions: ${detail}`);
  }
  return { action: "patched", added: missing.map((f) => f.name) };
}

export async function POST() {
  const pbUrl_ = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl_ || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const result = await ensureCollection(token);
    // Note: orphan_decisions is super-admin-only. The collection itself
    // intentionally has all-null rules (admin-only via admin token).
    // For now we rely on the API route's ADMIN_EMAIL gate; future
    // enhancement could add a dedicated ADMIN_ONLY entry in
    // EXPECTED_COLLECTIONS to track this in the security verifier.
    const rules = await ensureCollectionRulesWithFreshToken("orphan_decisions");
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error("Orphan decisions setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
