/**
 * Idempotent setup for `generation_models` (W95.7.3d-T1) — cached Muapi model
 * catalog with derived tier + credit_weight. ADMIN_ONLY (operator infra, no
 * user rows; NOT in the GDPR user-cascade). Populated hourly by
 * /api/worker/muapi-catalog-sync. Gated by proxy.ts dual-auth.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "generation_models";
const FIELDS = [
  { name: "name", type: "text", required: true },
  { name: "category", type: "text", required: false },
  { name: "cost_usd", type: "number", required: false },        // null for dynamic_pricing models
  { name: "cost_strategy", type: "text", required: false },
  { name: "dynamic_pricing", type: "bool", required: false },
  { name: "endpoint", type: "text", required: false },
  { name: "estimate_endpoint", type: "text", required: false },
  { name: "kind", type: "text", required: false },             // "image" | "video"
  { name: "tier", type: "text", required: false },             // "quick" | "pro" | "premium"
  { name: "credit_weight", type: "number", required: false },
  { name: "recommended_for", type: "json", required: false },
  { name: "last_synced_at", type: "text", required: false },
];

export async function POST() {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const result = await ensureBaseCollection(token, NAME, FIELDS);
    const rules = await ensureCollectionRulesWithFreshToken(NAME);
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error(`${NAME} setup error:`, err);
    return Response.json({ error: "Setup failed", detail: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
export const GET = POST;
