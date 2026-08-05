import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import { sendPushToUser } from "../push";
import {
  notificationDeliveryKey,
  notificationDigestDeliveryItem,
  type NotificationDeliveryRecord,
} from "./notification-dispatch";
import type { NotificationDigest } from "./notification-digest";
import { notificationDeliveryRetryable } from "./notification-retry";

type DeliverySummary = { attempted: number; sent: number; skipped: number; failed: number };
type PushDigestDeliveryRecord = NotificationDeliveryRecord & { attempts?: number; updated?: string };

export function pushPayloadForDigest(digest: NotificationDigest) {
  const deliveryItem = notificationDigestDeliveryItem(digest);
  if (!deliveryItem) return null;

  const parts = [
    `${digest.summary.critical} critical`,
    `${digest.summary.high} high`,
    `${digest.summary.normal} normal`,
  ];

  return {
    title: deliveryItem.title,
    body: `${digest.summary.total} item${digest.summary.total === 1 ? "" : "s"} need attention · ${parts.join(" · ")}`,
    url: deliveryItem.actionHref,
    tag: `staffd-${deliveryItem.id}`,
  };
}

async function findDelivery(deliveryKey: string, token: string): Promise<PushDigestDeliveryRecord | null> {
  const filter = `delivery_key='${pbEscape(deliveryKey)}'`;
  const response = await fetch(
    `${pbUrl()}/api/collections/notification_deliveries/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: adminHeaders(token), cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`notification delivery lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: PushDigestDeliveryRecord[] };
  return payload.items?.[0] ?? null;
}

async function retryFailedDelivery(
  delivery: PushDigestDeliveryRecord,
  token: string,
): Promise<PushDigestDeliveryRecord | null> {
  if (!notificationDeliveryRetryable(delivery)) return null;
  const response = await fetch(`${pbUrl()}/api/collections/notification_deliveries/records/${delivery.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({
      status: "pending",
      attempts: Math.max(1, delivery.attempts ?? 1) + 1,
      last_error: "",
    }),
  });
  if (!response.ok) return null;
  return (await response.json()) as PushDigestDeliveryRecord;
}

async function claimDelivery(
  userId: string,
  digest: NotificationDigest,
  token: string,
): Promise<PushDigestDeliveryRecord | null> {
  const deliveryItem = notificationDigestDeliveryItem(digest);
  if (!deliveryItem) return null;

  const deliveryKey = notificationDeliveryKey(userId, deliveryItem, "push");
  const existing = await findDelivery(deliveryKey, token).catch(() => null);
  if (existing) return retryFailedDelivery(existing, token);

  const response = await fetch(`${pbUrl()}/api/collections/notification_deliveries/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: userId,
      delivery_key: deliveryKey,
      channel: "push",
      source_item_id: deliveryItem.id,
      occurred_at: deliveryItem.occurredAt,
      status: "pending",
      attempts: 1,
    }),
  });
  if (response.status === 404) return null;
  if (response.status === 400 || response.status === 409) {
    const claimed = await findDelivery(deliveryKey, token).catch(() => null);
    return claimed ? retryFailedDelivery(claimed, token) : null;
  }
  if (!response.ok) throw new Error(`notification delivery claim failed (${response.status})`);
  return (await response.json()) as PushDigestDeliveryRecord;
}

async function markDelivery(
  recordId: string,
  status: "sent" | "failed",
  token: string,
  detail?: string,
): Promise<void> {
  await fetch(`${pbUrl()}/api/collections/notification_deliveries/records/${recordId}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({
      status,
      delivered_at: status === "sent" ? new Date().toISOString() : "",
      last_error: detail?.slice(0, 300) ?? "",
    }),
  });
}

export async function dispatchPushDigest(
  userId: string,
  digest: NotificationDigest,
): Promise<DeliverySummary> {
  const payload = pushPayloadForDigest(digest);
  if (!payload || !digest.channels.includes("push")) {
    return { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return { attempted: 0, sent: 0, skipped: 1, failed: 0 };
  }

  const claim = await claimDelivery(userId, digest, token);
  if (!claim) return { attempted: 1, sent: 0, skipped: 1, failed: 0 };

  const result = await sendPushToUser(userId, payload).catch(() => ({ sent: 0, failed: 1, skipped: false }));
  if (result.sent > 0) {
    await markDelivery(claim.id, "sent", token).catch(() => undefined);
    return { attempted: 1, sent: 1, skipped: 0, failed: 0 };
  }
  if (result.skipped || result.failed === 0) {
    await markDelivery(claim.id, "failed", token, "No active push subscription").catch(() => undefined);
    return { attempted: 1, sent: 0, skipped: 1, failed: 0 };
  }

  await markDelivery(claim.id, "failed", token, "Push digest provider delivery failed").catch(() => undefined);
  return { attempted: 1, sent: 0, skipped: 0, failed: 1 };
}
