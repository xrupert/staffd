/**
 * Idempotent setup for the `templates` PocketBase collection.
 *
 * Partial fix for Bundle 6 G0 anomaly (Decision 69 accelerated). The full
 * Bundle 6 Model C schema (scope + variables + capabilities + tags +
 * recency + pack/global) ships in Tranche 7 via PR-Templates-A; this PR
 * lands the BASELINE setup route + row rules so security is restored
 * NOW without waiting for Tranche 7.
 *
 * Current production schema (inferred from `dashboard/templates/page.tsx`
 * + `lib/starterTemplates.ts` per Bundle 6 audit):
 *
 *   user        (text, required) — owner
 *   name        (text, required)
 *   department  (text, optional — empty string = all departments)
 *   content     (text, required)
 *
 * Tranche 7 will extend this schema. Until then, the patch-missing-fields
 * pattern preserves any extra fields production already has.
 */

import {
  adminHeaders,
  getAdminToken,
  pbUrl,
} from "../../_lib/pb";
import { ensureCollectionRules } from "../../_lib/security/row-rules";

const REQUIRED_FIELDS = [
  { name: "user",       type: "text", required: true },
  { name: "name",       type: "text", required: true },
  { name: "department", type: "text", required: false },
  { name: "content",    type: "text", required: false },
];

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();

  const colRes = await fetch(`${url}/api/collections/templates`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        name: "templates",
        type: "base",
        fields: REQUIRED_FIELDS,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create templates: ${detail}`);
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
    throw new Error(`Failed to patch templates: ${detail}`);
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
    // Decision 69 — every setup route enforces row rules per the central registry.
    const rulesResult = await ensureCollectionRules(token, "templates");
    return Response.json({ ok: true, ...result, rules: rulesResult.status });
  } catch (err) {
    console.error("Templates setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
