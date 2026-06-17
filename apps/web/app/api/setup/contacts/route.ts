/**
 * Idempotent setup for `contacts` (W95.1).
 *
 * STAFFD-native contacts — the Model B3 source of truth. Confirmed via the
 * conversational-intent flow (or CSV upload, W95.3), then mirrored to the
 * operator-shared Twenty (tenant-tagged). USER_OWNED_RULES isolate rows.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "contacts";

const REQUIRED_FIELDS = [
  { name: "user",                type: "text", required: true  },
  { name: "name",                type: "text", required: true  },
  { name: "email",               type: "text", required: false },
  { name: "phone",               type: "text", required: false },
  { name: "context",             type: "text", required: false }, // "met at the trade show"
  { name: "twenty_record_id",    type: "text", required: false },
  { name: "twenty_mirror_status", type: "text", required: false }, // pending | synced | error
  { name: "last_mirror_attempt", type: "text", required: false },
];

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/${COLLECTION_NAME}`, { headers: { Authorization: token } });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ name: COLLECTION_NAME, type: "base", fields: REQUIRED_FIELDS }),
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
    body: JSON.stringify({ fields: [...(col.fields ?? []), ...missing] }),
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
