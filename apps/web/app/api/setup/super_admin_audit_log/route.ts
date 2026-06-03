/**
 * Idempotent setup for `super_admin_audit_log` (Decision 74).
 *
 * Logs every super-admin bypass, dashboard access, and admin API call.
 * Admin-only via ADMIN_ONLY_RULES + systemManaged in EXPECTED_COLLECTIONS.
 *
 * Schema:
 *   user          (relation → users) — super-admin who acted
 *   action_type   (text, required)   — "api_call" | "dashboard_view" |
 *                                       "pack_access_bypass" | etc.
 *   resource      (text, required)   — route path | pack id | agent id | etc.
 *   parameters    (text, optional)   — JSON-stringified, sanitized request
 *                                       params (secrets redacted)
 *   result        (text, optional)   — "success" | "error" | "denied"
 *                                       (default: "success")
 *   error_detail  (text, optional)   — stack/detail when result=="error"
 *   ip_address    (text, optional)   — request origin
 *   user_agent    (text, optional)   — browser/client info
 *   created       (autodate)         — timestamp
 *
 * Note: `parameters` is `text` (stringified JSON) rather than PB `json`
 * type to keep setup-route patch logic simple and avoid PB-side JSON
 * validation surprises. Application reads parse-then-JSON.parse().
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "super_admin_audit_log";

const REQUIRED_FIELDS = [
  { name: "user",         type: "text", required: true  },
  { name: "action_type",  type: "text", required: true  },
  { name: "resource",     type: "text", required: true  },
  { name: "parameters",   type: "text", required: false },
  { name: "result",       type: "text", required: false },
  { name: "error_detail", type: "text", required: false },
  { name: "ip_address",   type: "text", required: false },
  { name: "user_agent",   type: "text", required: false },
];

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/${COLLECTION_NAME}`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        name: COLLECTION_NAME,
        type: "base",
        fields: REQUIRED_FIELDS,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create ${COLLECTION_NAME}: ${detail}`);
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
    throw new Error(`Failed to patch ${COLLECTION_NAME}: ${detail}`);
  }
  return { action: "patched", added: missing.map((f) => f.name) };
}

export async function POST() {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const result = await ensureCollection(token);
    const rules = await ensureCollectionRulesWithFreshToken(COLLECTION_NAME);
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error(`${COLLECTION_NAME} setup error:`, err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
