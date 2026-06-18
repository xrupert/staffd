/**
 * Idempotent setup for `leads` (W95.4a) — captured sales leads, linked to a
 * contacts row + mirrored to the operator-shared CRM. USER_OWNED. Gated by
 * proxy.ts dual-auth.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "leads";
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "contact", type: "text", required: false },         // contacts record id
  { name: "company", type: "text", required: false },
  { name: "interest_summary", type: "text", required: false },
  { name: "source", type: "text", required: false },
  { name: "status", type: "text", required: false },          // new | qualified | converted | lost
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
