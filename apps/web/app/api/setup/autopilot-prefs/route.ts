/**
 * Idempotent setup for `autopilot_prefs` (W95.5) — per (user, intent_type)
 * graduation state: confirm streak, enabled flag, suppression/cooldown stamps.
 * USER_OWNED. Composite (user,intent_type) uniqueness is enforced by the
 * find-or-create pattern in _lib/autopilot/policy.ts (PB has no composite
 * unique). Gated by proxy.ts dual-auth.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "autopilot_prefs";
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "intent_type", type: "text", required: true },
  { name: "confirm_streak", type: "number", required: false },
  { name: "enabled", type: "bool", required: false },
  { name: "enabled_at", type: "text", required: false },
  { name: "last_confirm_at", type: "text", required: false },
  { name: "offer_suppressed_until", type: "text", required: false },
  { name: "revoked_at", type: "text", required: false },
  { name: "threshold_override", type: "number", required: false },
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
