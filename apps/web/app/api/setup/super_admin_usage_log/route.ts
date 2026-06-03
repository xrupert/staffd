/**
 * Idempotent setup for `super_admin_usage_log` (Decision 74).
 *
 * Logs premium operations the super-admin triggered that would have cost
 * a normal user credits (image generation, video generation, agent calls,
 * etc.). Admin-only via ADMIN_ONLY_RULES + systemManaged in
 * EXPECTED_COLLECTIONS.
 *
 * Schema:
 *   user             (text, required) — super-admin user id
 *   operation_type   (text, required) — "image_generation" |
 *                                        "video_generation" |
 *                                        "agent_credit_spend" | etc.
 *   operation_detail (text, optional) — human-readable detail
 *   parameters       (text, optional) — JSON-stringified, sanitized
 *   created          (autodate)       — timestamp
 *
 * NOTE: cost estimation fields (estimated_cost_cents, cost_basis) are
 * DEFERRED per Decision 74 simplification. Add when there's real data
 * to estimate against; for now the operation log itself is the
 * primary visibility surface.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "super_admin_usage_log";

const REQUIRED_FIELDS = [
  { name: "user",             type: "text", required: true  },
  { name: "operation_type",   type: "text", required: true  },
  { name: "operation_detail", type: "text", required: false },
  { name: "parameters",       type: "text", required: false },
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
