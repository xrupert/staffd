/**
 * POST /api/push/subscribe
 *
 * Body: { userId, pbToken, subscription, userAgent? }
 * where `subscription` is the JSON object returned by
 * `PushSubscription.toJSON()` in the browser.
 *
 * Upserts a `push_subscriptions` row keyed by the subscription's endpoint.
 * Same endpoint = same device/browser, so re-subscribing replaces the prior
 * record instead of duplicating.
 *
 * Returns the public VAPID key alongside so callers don't need a second
 * round-trip to /api/push/vapid-public-key when they already have a token.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";
import { pushConfigured, vapidPublicKey } from "../../_lib/push";

type PushSubscriptionJSON = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
};

async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id === userId;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!pushConfigured()) {
    return Response.json({ ok: false, reason: "push_not_configured" }, { status: 503 });
  }

  let body: { userId?: string; pbToken?: string; subscription?: PushSubscriptionJSON; userAgent?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken, subscription, userAgent } = body;
  if (!userId || !pbToken || !subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const headers = adminHeaders(token);
    const existing = await pbFirst<{ id: string }>(
      "push_subscriptions",
      `(endpoint='${pbEscape(subscription.endpoint)}')`,
      token,
      { fields: "id" }
    );

    const payload = JSON.stringify({
      user: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: userAgent ?? "",
    });

    if (existing) {
      await fetch(`${url}/api/collections/push_subscriptions/records/${existing.id}`, {
        method: "PATCH",
        headers,
        body: payload,
      });
      return Response.json({ ok: true, action: "updated", vapidPublicKey: vapidPublicKey() });
    }

    const res = await fetch(`${url}/api/collections/push_subscriptions/records`, {
      method: "POST",
      headers,
      body: payload,
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json({ error: "pb_write_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
    return Response.json({ ok: true, action: "created", vapidPublicKey: vapidPublicKey() });
  } catch (err) {
    console.error("push subscribe error:", err);
    return Response.json({ error: "subscribe_failed" }, { status: 500 });
  }
}

/** GET — convenience for the client to fetch the VAPID public key without a token. */
export async function GET() {
  if (!pushConfigured()) {
    return Response.json({ ok: false, reason: "push_not_configured" }, { status: 503 });
  }
  return Response.json({ ok: true, vapidPublicKey: vapidPublicKey() });
}
