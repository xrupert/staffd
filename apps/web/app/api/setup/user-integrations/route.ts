/**
 * Idempotent setup for `user_integrations` (W91).
 *
 * Per-user vendor credentials, encrypted at rest. USER_OWNED_RULES enforce
 * row isolation; the api_key field holds a "v1:iv:tag:ct" AES-GCM blob, never
 * plaintext. Unique index on (user, integration_type) — one cred set per
 * vendor per user.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "user_integrations";

const REQUIRED_FIELDS = [
  { name: "user",              type: "text", required: true  },
  { name: "integration_type",  type: "text", required: true  },
  { name: "connection_url",    type: "text", required: false },
  { name: "api_key",           type: "text", required: false }, // v1:iv:tag:ciphertext
  { name: "additional_config", type: "json", required: false },
  { name: "status",            type: "text", required: false },
  { name: "last_verified_at",  type: "text", required: false },
  { name: "last_error",        type: "text", required: false },
];

const UNIQUE_INDEX = `CREATE UNIQUE INDEX idx_user_integration ON ${COLLECTION_NAME} (user, integration_type)`;

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/${COLLECTION_NAME}`, { headers: { Authorization: token } });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ name: COLLECTION_NAME, type: "base", fields: REQUIRED_FIELDS, indexes: [UNIQUE_INDEX] }),
    });
    if (!createRes.ok) throw new Error(`Failed to create ${COLLECTION_NAME}: ${await createRes.text()}`);
    return { action: "created" };
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" };

  const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ fields: [...(col.fields ?? []), ...missing], indexes: [UNIQUE_INDEX] }),
  });
  if (!patchRes.ok) throw new Error(`Failed to patch ${COLLECTION_NAME}: ${await patchRes.text()}`);
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
    return Response.json({ error: "Setup failed", detail: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}

export const GET = POST;
