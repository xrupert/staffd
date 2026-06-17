/**
 * Idempotent setup for `admin_migration_log` (W95.3.4).
 *
 * Operator-only audit of in-app PB migrations: one row per setup-route run
 * from /dashboard/admin/migrations. ADMIN_ONLY (PB defaults a freshly-created
 * collection's rules to admin-only, which equals ADMIN_ONLY_RULES — no rule
 * PATCH needed; ensureCollectionRules treats it as system-managed).
 *
 * ⚠️ SELF-BOOTSTRAP: this collection cannot be created via the in-app trigger
 * (the trigger logs to it). The FIRST creation must use the x-setup-secret
 * path, once, from Git Bash:
 *   curl -X POST -H "x-setup-secret: $ADMIN_SECRET" .../api/setup/admin-migration-log
 * After that, every other migration runs via the button.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "admin_migration_log";

const REQUIRED_FIELDS = [
  { name: "user",           type: "text",   required: false }, // operator who ran it
  { name: "migration_name", type: "text",   required: true  }, // e.g. "contacts"
  { name: "ran_at",         type: "text",   required: false },
  { name: "result",         type: "text",   required: false }, // created | exists | rules-failed | error
  { name: "response_body",  type: "text",   required: false }, // full JSON for debugging
  { name: "duration_ms",    type: "number", required: false },
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
