/**
 * Idempotent setup for `upload_sessions` (W95.3).
 *
 * Per-customer ledger of cold-start data uploads (contacts CSV, document
 * archives). USER_OWNED_RULES isolate rows — each owner sees only their own
 * upload history (the /dashboard/upload "recent uploads" list). The operator-
 * facing audit copy still lands in super_admin_usage_log.
 *
 * Gated by proxy.ts (x-setup-secret → ADMIN_SECRET). Standard #1.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "upload_sessions";

const REQUIRED_FIELDS = [
  { name: "user",       type: "text",   required: true  },
  { name: "kind",       type: "text",   required: true  }, // "contacts" | "documents"
  { name: "file_count", type: "number", required: false },
  { name: "row_count",  type: "number", required: false },
  { name: "succeeded",  type: "number", required: false },
  { name: "failed",     type: "number", required: false },
  { name: "summary",    type: "text",   required: false }, // STAFFD-voice one-liner for the UI
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
