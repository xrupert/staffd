/**
 * Idempotent setup for `billing_events` — the Paddle webhook dedup ledger.
 *
 * One row per delivered webhook event id. The UNIQUE index on event_id is
 * the idempotency mechanism: the webhook inserts before processing, and a
 * 400 (duplicate) means "already handled, 200 without reprocessing".
 *
 * Schema:
 *   event_id   (text, required, UNIQUE) — Paddle event id (evt_...)
 *   event_type (text, required)        — e.g. subscription.updated
 *   created    (autodate)              — when first processed
 *
 * Row rules: admin-only (ADMIN_ONLY_RULES) — backend-only ledger, written
 * exclusively via the admin token from the webhook route.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const REQUIRED_FIELDS = [
  { name: "event_id",   type: "text", required: true },
  { name: "event_type", type: "text", required: true },
];

const UNIQUE_INDEX = "CREATE UNIQUE INDEX `idx_billing_events_event_id` ON `billing_events` (`event_id`)";

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched" }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/billing_events`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        name: "billing_events",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: [UNIQUE_INDEX],
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create billing_events: ${await createRes.text()}`);
    }
    return { action: "created" };
  }

  const col = (await colRes.json()) as {
    id: string;
    fields?: Array<{ name: string }>;
    indexes?: string[];
  };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missingFields = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));
  const hasIndex = (col.indexes ?? []).some((i) => i.includes("idx_billing_events_event_id"));
  if (missingFields.length === 0 && hasIndex) return { action: "noop" };

  const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({
      fields: [...(col.fields ?? []), ...missingFields],
      indexes: hasIndex ? col.indexes : [...(col.indexes ?? []), UNIQUE_INDEX],
    }),
  });
  if (!patchRes.ok) {
    throw new Error(`Failed to patch billing_events: ${await patchRes.text()}`);
  }
  return { action: "patched" };
}

export async function POST() {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const result = await ensureCollection(token);
    const rules = await ensureCollectionRulesWithFreshToken("billing_events");
    return Response.json({ ok: true, collection: result.action, rules });
  } catch (err) {
    console.error("[setup/billing-events]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
