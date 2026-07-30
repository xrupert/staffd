/**
 * POST /api/webhooks/paddle — the single entitlement source of truth.
 *
 * Delivery contract (Paddle): only a 2xx within 5s counts as delivered;
 * anything else is retried (sandbox ~3 attempts, live ~60 over 3 days) with
 * the SAME event id each time. So: verify signature, dedupe on event id,
 * process fast, and always 200 events we understood but chose to skip —
 * 4xx/5xx are reserved for "retry might actually help".
 *
 * Security: signature verified via the Paddle SDK (lazy import, Standard
 * #26) against PADDLE_NOTIFICATION_WEBHOOK_SECRET. Fail-closed: 503 when
 * the secret is unset. Identity comes from customData.staffd_user_id that
 * OUR checkout routes stamped — never from anything a caller could forge
 * without also forging the signature (Standard #39 spirit).
 *
 * Idempotency: a `billing_events` PB row per event id (unique index). A
 * duplicate insert → 200 {duplicate:true} without reprocessing.
 *
 * Event → handler mapping mirrors the deleted Stripe webhook semantics
 * (git e456b6f~1) and is a registry append per PARADIGM.md:
 *   subscription created/activated/updated  → sync plan or add-on
 *   subscription canceled                   → revert plan / clear add-on
 *   transaction.completed (one-time)        → Cinema-pack clip top-up
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { planForPriceId, cinemaClipsForPriceId } from "../../_lib/billing/prices";

type SubRow = {
  id: string;
  plan?: string;
  paddle_customer?: string;
  paddle_sub_id?: string;
  dept_addon_subs?: Record<string, string>;
  ceo_addon_sub?: string;
  cinema_pack_topups?: number;
};

type PaddleSubData = {
  id: string;
  status?: string;
  customerId?: string;
  customData?: Record<string, unknown> | null;
  currentBillingPeriod?: { endsAt?: string } | null;
  items?: Array<{ price?: { id?: string } }>;
};

type PaddleTxnData = {
  id: string;
  subscriptionId?: string | null;
  customData?: Record<string, unknown> | null;
  items?: Array<{ price?: { id?: string }; quantity?: number }>;
};

async function findSubRowByUser(token: string, userId: string): Promise<SubRow | null> {
  const res = await fetch(
    `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: SubRow[] };
  return data.items?.[0] ?? null;
}

async function findSubRowByPaddleCustomer(token: string, customerId: string): Promise<SubRow | null> {
  const res = await fetch(
    `${pbUrl()}/api/collections/subscriptions/records?filter=(paddle_customer='${pbEscape(customerId)}')&perPage=1`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: SubRow[] };
  return data.items?.[0] ?? null;
}

async function patchSubRow(token: string, rowId: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${pbUrl()}/api/collections/subscriptions/records/${rowId}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`subscriptions patch failed (${res.status}): ${await res.text()}`);
}

async function createSubRow(token: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${pbUrl()}/api/collections/subscriptions/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`subscriptions create failed (${res.status}): ${await res.text()}`);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** subscription created/activated/updated — route by customData add-on type. */
async function syncSubscription(data: PaddleSubData): Promise<void> {
  const token = await getAdminToken();
  const custom = data.customData ?? {};
  const userId = str(custom.staffd_user_id);
  const addonType = str(custom.staffd_addon_type);
  const status = data.status ?? "active";
  const canceled = status === "canceled";

  // Resolve the row: prefer the stamped user id, fall back to the Paddle
  // customer id for events on subs whose customData we didn't stamp.
  let row = userId ? await findSubRowByUser(token, userId) : null;
  if (!row && data.customerId) row = await findSubRowByPaddleCustomer(token, data.customerId);

  // Department add-on — unlock/remove the dept; never touch plan.
  if (addonType === "department") {
    const dept = str(custom.staffd_addon_dept);
    if (!row || !dept) return;
    const map = { ...(row.dept_addon_subs ?? {}) };
    if (canceled) {
      for (const k of Object.keys(map)) if (map[k] === data.id) delete map[k];
    } else {
      map[dept] = data.id;
    }
    await patchSubRow(token, row.id, { dept_addon_subs: map });
    return;
  }

  // CEO add-on — set/clear ceo_addon_sub; never touch plan.
  if (addonType === "ceo") {
    if (!row) return;
    if (canceled) {
      if (row.ceo_addon_sub && row.ceo_addon_sub !== data.id) return; // superseded
      await patchSubRow(token, row.id, { ceo_addon_sub: "" });
    } else {
      await patchSubRow(token, row.id, { ceo_addon_sub: data.id });
    }
    return;
  }

  // Standard plan subscription.
  const priceId = data.items?.[0]?.price?.id ?? "";
  const plan = str(custom.staffd_plan) ?? planForPriceId(priceId);

  if (canceled) {
    if (!row) return;
    if (row.paddle_sub_id && row.paddle_sub_id !== data.id) return; // superseded by a newer sub
    await patchSubRow(token, row.id, { plan: "starter", paddle_sub_id: "", active_until: "" });
    return;
  }

  if (!plan) return; // not one of ours — skip (200, no retry value)
  const fields = {
    plan,
    paddle_customer: data.customerId ?? "",
    paddle_sub_id: data.id,
    active_until: data.currentBillingPeriod?.endsAt ?? "",
  };
  if (row) {
    await patchSubRow(token, row.id, fields);
  } else if (userId) {
    await createSubRow(token, { user: userId, ...fields });
  }
}

/** transaction.completed — Cinema-pack one-time purchases only. */
async function handleTransactionCompleted(data: PaddleTxnData): Promise<void> {
  if (data.subscriptionId) return; // recurring invoice — plan sync owns those
  const userId = str((data.customData ?? {}).staffd_user_id);
  if (!userId) return;

  let clips = 0;
  for (const item of data.items ?? []) {
    const per = cinemaClipsForPriceId(item.price?.id ?? "");
    if (per) clips += per * Math.max(1, item.quantity ?? 1);
  }
  if (clips === 0) return;

  const token = await getAdminToken();
  const row = await findSubRowByUser(token, userId);
  if (!row) return;
  await patchSubRow(token, row.id, {
    cinema_pack_topups: Math.max(0, row.cinema_pack_topups ?? 0) + clips,
  });
}

/** Registry append point (PARADIGM.md) — event type → handler. */
export const PADDLE_EVENT_HANDLERS: Record<string, (data: never) => Promise<void>> = {
  "subscription.created": syncSubscription as (data: never) => Promise<void>,
  "subscription.activated": syncSubscription as (data: never) => Promise<void>,
  "subscription.updated": syncSubscription as (data: never) => Promise<void>,
  "subscription.canceled": syncSubscription as (data: never) => Promise<void>,
  "transaction.completed": handleTransactionCompleted as (data: never) => Promise<void>,
};

/** Insert the dedup row; false = this event id was already processed. */
async function recordEventOnce(eventId: string, eventType: string): Promise<boolean> {
  const token = await getAdminToken();
  const res = await fetch(`${pbUrl()}/api/collections/billing_events/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({ event_id: eventId, event_type: eventType }),
  });
  if (res.ok) return true;
  if (res.status === 400) return false; // unique index violation → duplicate
  throw new Error(`billing_events insert failed (${res.status}): ${await res.text()}`);
}

export async function POST(req: Request) {
  const secret = process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const signature = req.headers.get("paddle-signature") ?? "";
  const rawBody = await req.text();

  let event: { eventId: string; eventType: string; data: unknown };
  try {
    const { Paddle, Environment } = await import("@paddle/paddle-node-sdk");
    const paddle = new Paddle(process.env.PADDLE_API_KEY ?? "unused-for-verification", {
      environment:
        process.env.NEXT_PUBLIC_PADDLE_ENV === "production"
          ? Environment.production
          : Environment.sandbox,
    });
    const unmarshaled = await paddle.webhooks.unmarshal(rawBody, secret, signature);
    event = unmarshaled as unknown as { eventId: string; eventType: string; data: unknown };
  } catch (err) {
    // The SDK throws for BOTH bad signatures and schema-invalid payloads
    // (discovered during sandbox verification — a skeleton payload with a
    // VALID signature still throws in entity mapping). Label them apart so
    // a 401 always means "check the secret", never "check the payload".
    const msg = err instanceof Error ? err.message : String(err);
    if (/signature/i.test(msg)) {
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }
    console.error("[paddle.webhook] unparseable payload:", msg);
    return Response.json({ error: "unparseable_payload" }, { status: 400 });
  }

  const handler = PADDLE_EVENT_HANDLERS[event.eventType];
  if (!handler) return Response.json({ ok: true, skipped: event.eventType });

  try {
    const fresh = await recordEventOnce(event.eventId, event.eventType);
    if (!fresh) return Response.json({ ok: true, duplicate: true });
    await handler(event.data as never);
    return Response.json({ ok: true });
  } catch (err) {
    // 500 → Paddle retries with the same event id; the dedup row may already
    // exist, so remove it to let the retry actually reprocess.
    console.error(`[paddle.webhook] ${event.eventType} ${event.eventId} failed:`, err);
    try {
      const token = await getAdminToken();
      const res = await fetch(
        `${pbUrl()}/api/collections/billing_events/records?filter=(event_id='${pbEscape(event.eventId)}')&perPage=1`,
        { headers: { Authorization: token } },
      );
      const data = (await res.json()) as { items?: Array<{ id: string }> };
      const rowId = data.items?.[0]?.id;
      if (rowId) {
        await fetch(`${pbUrl()}/api/collections/billing_events/records/${rowId}`, {
          method: "DELETE",
          headers: { Authorization: token },
        });
      }
    } catch {
      /* best effort — a stuck dedup row is recoverable via Paddle's replay */
    }
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
