/**
 * Idempotent setup for `generation_jobs` (W95.7.3b) — async image/video
 * generation job ledger. USER_OWNED. Backs the sync→async Muapi conversion:
 * POST /api/integrations/muapi submits a job + writes a row here; the client
 * polls GET /api/generation/<id>/status until it completes. `charged` is the
 * claim-first idempotency guard (charge exactly once at completion-discovery).
 * Gated by proxy.ts dual-auth.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "generation_jobs";
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "kind", type: "text", required: false },          // "image" | "video"
  { name: "status", type: "text", required: false },        // "pending" | "completed" | "failed"
  { name: "model", type: "text", required: false },         // Muapi model endpoint used
  { name: "prompt", type: "text", required: false },        // focused prompt (resume / debug)
  { name: "aspect_ratio", type: "text", required: false },
  { name: "prediction_id", type: "text", required: false }, // Muapi prediction id (resume key + webhook match)
  { name: "output_url", type: "text", required: false },    // populated on completion
  { name: "charged", type: "bool", required: false },       // claim-first idempotency guard
  { name: "error", type: "text", required: false },         // populated on failure
  // W95.7.3c-b1 — submit-time dedup: sha256(userId|kind|prompt|aspect_ratio).
  // A matching pending job within the in-flight window is reused instead of
  // re-submitting to Muapi (margin protection — Muapi debits on completion).
  { name: "fingerprint", type: "text", required: false },
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
