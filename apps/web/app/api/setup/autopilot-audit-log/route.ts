/**
 * Idempotent setup for `autopilot_audit_log` (W95.5) — one row per autopilot
 * fire, carrying everything needed to UNDO it within the 10-minute window
 * (target row, previous state for updates, vendor mirror task ids). USER_OWNED.
 * Gated by proxy.ts dual-auth.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "autopilot_audit_log";
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "intent_type", type: "text", required: true },
  { name: "fields_committed", type: "json", required: false },
  { name: "previous_state", type: "json", required: false },
  { name: "target_collection", type: "text", required: false },
  { name: "target_record_id", type: "text", required: false },
  { name: "vendor_mirror_task_ids", type: "json", required: false },
  { name: "committed_at", type: "text", required: false },
  { name: "undo_window_expires_at", type: "text", required: false },
  { name: "undone_at", type: "text", required: false },
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
