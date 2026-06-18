/**
 * POST /api/setup/workflows-v2 (W95.6.x) — adds the review-step fields to the
 * workflows collection: review_required (bool) + draft_output (text). status is
 * already a free-text field, so the "awaiting_review"/"cancelled" values need no
 * schema change. Idempotent. Gated by proxy.ts dual-auth.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";

const COLLECTION = "workflows";
const NEW_FIELDS = [
  { name: "review_required", type: "bool", required: false },
  { name: "draft_output", type: "text", required: false },
];

export async function POST() {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const colRes = await fetch(`${url}/api/collections/${COLLECTION}`, { headers: { Authorization: token } });
    if (!colRes.ok) return Response.json({ error: `${COLLECTION} collection not found` }, { status: 409 });
    const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
    const existing = new Set((col.fields ?? []).map((f) => f.name));
    const missing = NEW_FIELDS.filter((f) => !existing.has(f.name));
    if (missing.length === 0) return Response.json({ ok: true, action: "already-migrated" });
    const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
      method: "PATCH", headers: adminHeaders(token),
      body: JSON.stringify({ fields: [...(col.fields ?? []), ...missing] }),
    });
    if (!patchRes.ok) return Response.json({ error: "patch_failed", detail: (await patchRes.text()).slice(0, 300) }, { status: 500 });
    return Response.json({ ok: true, action: "migrated", added: missing.map((f) => f.name) });
  } catch (err) {
    console.error("workflows-v2 setup error:", err);
    return Response.json({ error: "Setup failed", detail: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}

export const GET = POST;
