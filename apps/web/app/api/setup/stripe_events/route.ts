/**
 * Idempotent setup for `stripe_events` (W47).
 *
 * Webhook idempotency ledger — one row per processed Stripe event id.
 * The webhook checks this collection before processing any event and
 * inserts after successful processing, so Stripe re-deliveries never
 * double-credit a top-up or double-apply a subscription change.
 *
 * Schema:
 *   event_id     (text, required, unique-indexed) — Stripe event id (evt_…)
 *   event_type   (text, required)                 — e.g. checkout.session.completed
 *   user         (text, optional)                 — staffd user id when resolvable
 *   processed_at (text, required)                 — ISO datetime
 *
 * Admin-only via ADMIN_ONLY_RULES — only the webhook (admin token) touches it.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const COLLECTION_NAME = "stripe_events";

const REQUIRED_FIELDS = [
  { name: "event_id",     type: "text", required: true  },
  { name: "event_type",   type: "text", required: true  },
  { name: "user",         type: "text", required: false },
  { name: "processed_at", type: "text", required: true  },
];

const UNIQUE_EVENT_INDEX = `CREATE UNIQUE INDEX idx_stripe_events_event_id ON ${COLLECTION_NAME} (event_id)`;

async function ensureCollection(token: string): Promise<{ action: "created" | "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/${COLLECTION_NAME}`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        name: COLLECTION_NAME,
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: [UNIQUE_EVENT_INDEX],
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create ${COLLECTION_NAME}: ${detail}`);
    }
    return { action: "created" };
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }>; indexes?: string[] };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));
  const hasUniqueIndex = (col.indexes ?? []).some((i) => i.includes("idx_stripe_events_event_id"));
  if (missing.length === 0 && hasUniqueIndex) return { action: "noop" };

  const patchBody: Record<string, unknown> = {};
  if (missing.length > 0) patchBody.fields = [...(col.fields ?? []), ...missing];
  if (!hasUniqueIndex) patchBody.indexes = [...(col.indexes ?? []), UNIQUE_EVENT_INDEX];

  const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify(patchBody),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    throw new Error(`Failed to patch ${COLLECTION_NAME}: ${detail}`);
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
    const rules = await ensureCollectionRulesWithFreshToken(COLLECTION_NAME);
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error(`${COLLECTION_NAME} setup error:`, err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
