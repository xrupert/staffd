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

type DeliverySummary = { attempted: number; sent: number; skipped: number; failed: number };
type DeliveryChannel = "push" | "email";

export function notificationDeliveryKey(userId: string, item: BusinessInboxItem, channel: DeliveryChannel = "push"): string {
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function emailPayloadForInboxItem(recipient: string, item: BusinessInboxItem) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://urstaffd.com").replace(/\/$/, "");
  const actionUrl = new URL(item.actionHref, origin).toString();
  const evidence = item.evidence.length
    ? `<ul>${item.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`
    : "";
  return {
    from: process.env.STAFFD_NOTIFICATION_FROM || "STAFFD <notifications@urstaffd.com>",
    to: [recipient],
    subject: `[STAFFD] ${item.title}`,
    text: `${item.title}\n\n${item.summary}\n\n${item.evidence.join("\n")}\n\n${item.actionLabel}: ${actionUrl}`,
    html: `<h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p>${evidence}<p><a href="${escapeHtml(actionUrl)}">${escapeHtml(item.actionLabel)}</a></p>`,
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
  channel: DeliveryChannel,
): Promise<NotificationDeliveryRecord | null> {
  const response = await fetch(`${pbUrl()}/api/collections/notification_deliveries/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: userId,
      delivery_key: deliveryKey,
      channel,
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

async function claimDelivery(
  userId: string,
  item: BusinessInboxItem,
  channel: DeliveryChannel,
  token: string,
): Promise<NotificationDeliveryRecord | null> {
  const deliveryKey = notificationDeliveryKey(userId, item, channel);
  const existing = await findDelivery(deliveryKey, token).catch(() => null);
  if (existing?.status === "sent" || existing?.status === "pending") return null;
  const claim = await createPendingDelivery(userId, item, deliveryKey, token, channel).catch(() => null);
  if (!claim || claim.status === "sent" || claim.status === "pending" && existing?.id === claim.id) return null;
  return claim;
}

async function sendInboxEmail(recipient: string, item: BusinessInboxItem): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !recipient) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(emailPayloadForInboxItem(recipient, item)),
  });
  return response.ok;
}

export async function dispatchImmediatePushNotifications(
  userId: string,
  digest: NotificationDigest,
): Promise<DeliverySummary> {
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
    const claim = await claimDelivery(userId, item, "push", token);
    if (!claim) {
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

export async function dispatchImmediateEmailNotifications(
  userId: string,
  recipient: string,
  digest: NotificationDigest,
): Promise<DeliverySummary> {
  const emailItems = digest.immediate.filter((entry) => entry.channels.includes("email"));
  if (!emailItems.length) return { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  if (!process.env.RESEND_API_KEY || !recipient) {
    return { attempted: 0, sent: 0, skipped: emailItems.length, failed: 0 };
  }

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return { attempted: 0, sent: 0, skipped: emailItems.length, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const { item } of emailItems) {
    const claim = await claimDelivery(userId, item, "email", token);
    if (!claim) {
      skipped++;
      continue;
    }
    if (await sendInboxEmail(recipient, item).catch(() => false)) {
      sent++;
      await markDelivery(claim.id, "sent", token).catch(() => undefined);
    } else {
      failed++;
      await markDelivery(claim.id, "failed", token, "Email provider delivery failed").catch(() => undefined);
    }
  }
  return { attempted: emailItems.length, sent, skipped, failed };
}
