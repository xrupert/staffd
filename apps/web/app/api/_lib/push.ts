/**
 * Web Push helper (Phase 7).
 *
 * Wraps the `web-push` npm package with three operations the rest of the
 * platform uses:
 *
 *   sendPushToSubscription(subscription, payload)
 *     — encrypt + send a single push (VAPID-signed). Returns ok/410 so
 *       callers can prune stale subscriptions.
 *
 *   sendPushToUser(userId, payload)
 *     — fan-out: looks up every subscription for the user and sends to all.
 *       Prunes 404/410 subscriptions (browser unsubscribed or device gone).
 *
 *   pushConfigured()
 *     — boolean — true when VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY +
 *       VAPID_SUBJECT are all set. Callers should gate their work behind
 *       this so a missing env never throws into a hot path.
 *
 * VAPID keys are generated once with `npx web-push generate-vapid-keys`;
 * the public key is also exposed at `/api/push/vapid-public-key` for the
 * client-side subscribe flow.
 */

import webpush from "web-push";

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "./pb";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "";

let configured = false;
function ensureVapid(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
    return true;
  } catch (err) {
    console.warn("[push] setVapidDetails failed:", err);
    return false;
  }
}

export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
}

export function vapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;        // path to focus / open
  tag?: string;        // dedupes concurrent notifications
  icon?: string;
};

export type StoredSubscription = {
  id: string;
  user: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SendPushResult =
  | { ok: true; statusCode: number }
  | { ok: false; gone: boolean; statusCode?: number; reason?: string };

/**
 * Send to a single subscription. Returns `gone:true` on 404/410 so the
 * caller can delete the stored row.
 */
export async function sendPushToSubscription(
  sub: StoredSubscription,
  payload: PushPayload
): Promise<SendPushResult> {
  if (!ensureVapid()) {
    return { ok: false, gone: false, reason: "vapid_not_configured" };
  }
  try {
    const res = await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 24 * 60 * 60 }
    );
    return { ok: true, statusCode: res.statusCode };
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    const gone = code === 404 || code === 410;
    return { ok: false, gone, statusCode: code, reason: String(err) };
  }
}

/**
 * Fan-out push to every subscription belonging to a user. Prunes stale
 * subscriptions automatically. Returns a tally for logging.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; pruned: number; failed: number; skipped: boolean }> {
  if (!ensureVapid()) {
    return { sent: 0, pruned: 0, failed: 0, skipped: true };
  }
  if (!userId) return { sent: 0, pruned: 0, failed: 0, skipped: true };

  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch {
    return { sent: 0, pruned: 0, failed: 0, skipped: true };
  }

  let subs: StoredSubscription[] = [];
  try {
    const res = await fetch(
      `${url}/api/collections/push_subscriptions/records?filter=${encodeURIComponent(`(user='${pbEscape(userId)}')`)}&perPage=20`,
      { headers: { Authorization: token } }
    );
    if (res.ok) {
      const data = (await res.json()) as { items?: StoredSubscription[] };
      subs = data.items ?? [];
    }
  } catch {
    /* no subs; nothing to do */
  }

  if (subs.length === 0) return { sent: 0, pruned: 0, failed: 0, skipped: false };

  let sent = 0;
  let pruned = 0;
  let failed = 0;
  const headers = adminHeaders(token);

  await Promise.all(
    subs.map(async (s) => {
      const r = await sendPushToSubscription(s, payload);
      if (r.ok) {
        sent++;
      } else if (r.gone) {
        pruned++;
        try {
          await fetch(`${url}/api/collections/push_subscriptions/records/${s.id}`, {
            method: "DELETE",
            headers,
          });
        } catch { /* best-effort */ }
      } else {
        failed++;
        console.warn(`[push] send failed user=${userId} endpoint=${s.endpoint.slice(0, 40)}... reason=${r.reason}`);
      }
    })
  );

  return { sent, pruned, failed, skipped: false };
}
