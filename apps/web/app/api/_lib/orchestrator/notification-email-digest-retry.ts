import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import {
  emailPayloadForDigest,
  notificationDeliveryKey,
  notificationDigestDeliveryItem,
  type NotificationDeliveryRecord,
} from "./notification-dispatch";
import type { NotificationDigest } from "./notification-digest";
import { notificationDeliveryRetryable } from "./notification-retry";

type DeliverySummary = { attempted: number; sent: number; skipped: number; failed: number };
type RetryableDeliveryRecord = NotificationDeliveryRecord & { attempts?: number; updated?: string };

export function emailDigestRetryPatch(delivery: RetryableDeliveryRecord) {
  if (!notificationDeliveryRetryable(delivery)) return null;
  return {
    status: "pending" as const,
    attempts: Math.max(1, delivery.attempts ?? 1) + 1,
    last_error: "",
  };
}

async function findDelivery(deliveryKey: string, token: string): Promise<RetryableDeliveryRecord | null> {
  const filter = `delivery_key='${pbEscape(deliveryKey)}'`;
  const response = await fetch(
    `${pbUrl()}/api/collections/notification_deliveries/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: adminHeaders(token), cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`notification delivery lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: RetryableDeliveryRecord[] };
  return payload.items?.[0] ?? null;
}

async function reclaimDelivery(
  delivery: RetryableDeliveryRecord,
  token: string,
): Promise<RetryableDeliveryRecord | null> {
  const patch = emailDigestRetryPatch(delivery);
  if (!patch) return null;
  const response = await fetch(`${pbUrl()}/api/collections/notification_deliveries/records/${delivery.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify(patch),
  });
  if (!response.ok) return null;
  return (await response.json()) as RetryableDeliveryRecord;
}

async function claimDelivery(
  userId: string,
  digest: NotificationDigest,
  token: string,
): Promise<RetryableDeliveryRecord | null> {
  const deliveryItem = notificationDigestDeliveryItem(digest);
  if (!deliveryItem) return null;
  const deliveryKey = notificationDeliveryKey(userId, deliveryItem, "email");
  const existing = await findDelivery(deliveryKey, token).catch(() => null);
  if (existing) return reclaimDelivery(existing, token);

  const response = await fetch(`${pbUrl()}/api/collections/notification_deliveries/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: userId,
      delivery_key: deliveryKey,
      channel: "email",
      source_item_id: deliveryItem.id,
      occurred_at: deliveryItem.occurredAt,
      status: "pending",
      attempts: 1,
    }),
  });
  if (response.status === 404) return null;
  if (response.status === 400 || response.status === 409) {
    const claimed = await findDelivery(deliveryKey, token).catch(() => null);
    return claimed ? reclaimDelivery(claimed, token) : null;
  }
  if (!response.ok) throw new Error(`notification delivery claim failed (${response.status})`);
  return (await response.json()) as RetryableDeliveryRecord;
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

async function sendEmail(payload: NonNullable<ReturnType<typeof emailPayloadForDigest>>): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

export async function dispatchRetryableEmailDigest(
  userId: string,
  recipient: string,
  digest: NotificationDigest,
): Promise<DeliverySummary> {
  const payload = emailPayloadForDigest(recipient, digest);
  if (!payload || !digest.channels.includes("email")) {
    return { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }
  if (!process.env.RESEND_API_KEY || !recipient) {
    return { attempted: 0, sent: 0, skipped: 1, failed: 0 };
  }

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return { attempted: 0, sent: 0, skipped: 1, failed: 0 };
  }

  const claim = await claimDelivery(userId, digest, token);
  if (!claim) return { attempted: 1, sent: 0, skipped: 1, failed: 0 };
  if (await sendEmail(payload).catch(() => false)) {
    await markDelivery(claim.id, "sent", token).catch(() => undefined);
    return { attempted: 1, sent: 1, skipped: 0, failed: 0 };
  }
  await markDelivery(claim.id, "failed", token, "Email digest provider delivery failed").catch(() => undefined);
  return { attempted: 1, sent: 0, skipped: 0, failed: 1 };
}
