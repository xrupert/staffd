/**
 * Idempotent setup for the `notifications` PocketBase collection (W95.8).
 *
 * The per-customer system→user notification inbox. USER_OWNED — each customer
 * reads only their own rows (the bell queries `pb.collection("notifications")`
 * directly, secured by the row rules). Producers write server-side via the
 * admin token (`notifyUser`).
 *
 * Schema:
 *   user      (text, required) — owner
 *   type      (text, required) — NotificationType key (events.ts)
 *   title     (text, required)
 *   body      (text)
 *   href      (text)           — optional click-through
 *   severity  (text)           — info | success | warning
 *   read      (bool)
 *
 * Follows the patch-missing-fields pattern so re-runs are no-ops and any extra
 * fields prod already has are preserved (Standard #1 — rules enforced after).
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRules } from "../../_lib/security/row-rules";

const REQUIRED_FIELDS = [
  { name: "user",     type: "text", required: true },
  { name: "type",     type: "text", required: true },
  { name: "title",    type: "text", required: true },
  { name: "body",     type: "text", required: false },
  { name: "href",     type: "text", required: false },
  { name: "severity", type: "text", required: false },
  { name: "read",     type: "bool", required: false },
];

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();

  const colRes = await fetch(`${url}/api/collections/notifications`, { headers: { Authorization: token } });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ name: "notifications", type: "base", fields: REQUIRED_FIELDS }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create notifications: ${detail}`);
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
    throw new Error(`Failed to patch notifications: ${detail}`);
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
    const rulesResult = await ensureCollectionRules(token, "notifications");
    return Response.json({ ok: true, ...result, rules: rulesResult.status });
  } catch (err) {
    console.error("Notifications setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
