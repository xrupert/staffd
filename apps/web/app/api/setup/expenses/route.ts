/**
 * Idempotent setup for `expenses` (W95.4a) — logged business expenses.
 * USER_OWNED. Gated by proxy.ts dual-auth.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "expenses";
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "amount", type: "number", required: false },
  { name: "currency", type: "text", required: false },
  { name: "category", type: "text", required: false },
  { name: "description", type: "text", required: false },
  { name: "occurred_at", type: "text", required: false },
  { name: "client", type: "text", required: false },      // client name (optional, billable)
  { name: "billable", type: "bool", required: false },
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
