import { createHash } from "node:crypto";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import { sendPushToUser } from "../push";
import type { BusinessInboxItem } from "./business-inbox";
import type { NotificationDigest } from "./notification-digest";

export type NotificationDeliveryRecord = {
  id: string;
  delivery_key: string;
  status?: "pending" | "sent" | "failed";
};

export function notificationDeliveryKey(userId: string, item: BusinessInboxItem, channel = "push"): string {
  return createHash("sha256")
    .update([userId, channel, item.id, item.occurredAt].join(":"))
    .digest("hex");
}

export function pushPayloadForInboxItem(item: BusinessInboxItem) {
  return {
    title: item.title,
    body: item.summary,
    url: item.actionHref,
    tag: `staffd-${item.id}`,
  };
}

async function findDelivery(deliveryKey: string, token: string): Promise<NotificationDeliveryRecord | null> {
  const filter = `delivery_key='${pbEscape(deliveryKey)}'`;
  const response = await fetch(
    `${pbUrl()}/api/collections/notification_deliveries/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: adminHeaders(token), cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`notification delivery lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: NotificationDeliveryRecord[] };
  return payload.items?.[0] ?? null;
}

async function createPendingDelivery(
  userId: string,
  item: BusinessInboxItem,
  deliveryKey: string,
  token: string,
): Promise<NotificationDeliveryRecord | null> {
  const response = await fetch(`${pbUrl()}/api/collections/notification_deliveries/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: userId,
      delivery_key: deliveryKey,
      channel: "push",
      source_item_id: item.id,
      occurred_at: item.occurredAt,
      status: "pending",
      attempts: 1,
    }),
  });
  if (response.status === 404) return null;
  if (response.status === 400 || response.status === 409) return findDelivery(deliveryKey, token);
  if (!response.ok) throw new Error(`notification delivery claim failed (${response.status})`);
  return (await response.json()) as NotificationDeliveryRecord;
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

export async function dispatchImmediatePushNotifications(
  userId: string,
  digest: NotificationDigest,
): Promise<{ attempted: number; sent: number; skipped: number; failed: number }> {
  const pushItems = digest.immediate.filter((entry) => entry.channels.includes("push"));
  if (!pushItems.length) return { attempted: 0, sent: 0, skipped: 0, failed: 0 };

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return { attempted: 0, sent: 0, skipped: pushItems.length, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const { item } of pushItems) {
    const deliveryKey = notificationDeliveryKey(userId, item);
    const existing = await findDelivery(deliveryKey, token).catch(() => null);
    if (existing?.status === "sent" || existing?.status === "pending") {
      skipped++;
      continue;
    }

    const claim = await createPendingDelivery(userId, item, deliveryKey, token).catch(() => null);
    if (!claim || claim.status === "sent") {
      skipped++;
      continue;
    }

    const result = await sendPushToUser(userId, pushPayloadForInboxItem(item));
    if (result.sent > 0) {
      sent++;
      await markDelivery(claim.id, "sent", token).catch(() => undefined);
    } else if (result.skipped || result.failed === 0) {
      skipped++;
      await markDelivery(claim.id, "failed", token, "No active push subscription").catch(() => undefined);
    } else {
      failed++;
      await markDelivery(claim.id, "failed", token, "Push provider delivery failed").catch(() => undefined);
    }
  }

  return { attempted: pushItems.length, sent, skipped, failed };
}
