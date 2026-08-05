import { createHash } from "node:crypto";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import { sendPushToUser } from "../push";
import type { BusinessInboxItem } from "./business-inbox";
import type { NotificationDigest } from "./notification-digest";
import { notificationDeliveryRetryable } from "./notification-retry";

export type NotificationDeliveryRecord = {
  id: string;
  delivery_key: string;
  status?: "pending" | "sent" | "failed";
  attempts?: number;
  updated?: string;
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

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://urstaffd.com").replace(/\/$/, "");
}

export function emailPayloadForInboxItem(recipient: string, item: BusinessInboxItem) {
  const actionUrl = new URL(item.actionHref, appOrigin()).toString();
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

function digestPeriodStart(digest: NotificationDigest): Date | null {
  if (digest.frequency !== "daily" && digest.frequency !== "weekly") return null;
  const generatedAt = new Date(digest.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) return null;
  generatedAt.setUTCHours(0, 0, 0, 0);
  if (digest.frequency === "weekly") {
    const daysSinceMonday = (generatedAt.getUTCDay() + 6) % 7;
    generatedAt.setUTCDate(generatedAt.getUTCDate() - daysSinceMonday);
  }
  return generatedAt;
}

export function notificationDigestDeliveryItem(digest: NotificationDigest): BusinessInboxItem | null {
  const periodStart = digestPeriodStart(digest);
  if (!periodStart || !digest.digestItems.length) return null;
  const frequencyLabel = digest.frequency === "weekly" ? "Weekly" : "Daily";
  return {
    id: `notification-digest-${digest.frequency}-${periodStart.toISOString().slice(0, 10)}`,
    source: "notification",
    sourceId: `digest-${digest.frequency}`,
    kind: "summary",
    priority: digest.summary.critical > 0 ? "critical" : digest.summary.high > 0 ? "high" : "normal",
    title: `${frequencyLabel} owner digest`,
    summary: `${digest.summary.total} item${digest.summary.total === 1 ? "" : "s"} need your attention in STAFFD.`,
    evidence: [
      `${digest.summary.critical} critical`,
      `${digest.summary.high} high priority`,
      `${digest.summary.normal} normal priority`,
    ],
    actionLabel: "Open owner inbox",
    actionHref: "/dashboard",
    occurredAt: periodStart.toISOString(),
  };
}

export function emailPayloadForDigest(recipient: string, digest: NotificationDigest) {
  const deliveryItem = notificationDigestDeliveryItem(digest);
  if (!deliveryItem) return null;
  const actionUrl = new URL(deliveryItem.actionHref, appOrigin()).toString();
  const itemRows = digest.digestItems.slice(0, 20).map((item) => {
    const itemUrl = new URL(item.actionHref, appOrigin()).toString();
    return `<li><strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(item.summary)}<br><a href="${escapeHtml(itemUrl)}">${escapeHtml(item.actionLabel)}</a></li>`;
  }).join("");
  const remaining = Math.max(0, digest.digestItems.length - 20);
  const remainingText = remaining ? `<p>Plus ${remaining} more item${remaining === 1 ? "" : "s"} in your owner inbox.</p>` : "";
  const textItems = digest.digestItems.slice(0, 20).map((item) => `${item.title}: ${item.summary}`).join("\n");
  return {
    from: process.env.STAFFD_NOTIFICATION_FROM || "STAFFD <notifications@urstaffd.com>",
    to: [recipient],
    subject: `[STAFFD] ${deliveryItem.title}: ${digest.summary.total} item${digest.summary.total === 1 ? "" : "s"}`,
    text: `${deliveryItem.summary}\n\nCritical: ${digest.summary.critical}\nHigh: ${digest.summary.high}\nNormal: ${digest.summary.normal}\n\n${textItems}\n\nOpen owner inbox: ${actionUrl}`,
    html: `<h2>${escapeHtml(deliveryItem.title)}</h2><p>${escapeHtml(deliveryItem.summary)}</p><p><strong>${digest.summary.critical}</strong> critical · <strong>${digest.summary.high}</strong> high · <strong>${digest.summary.normal}</strong> normal</p><ol>${itemRows}</ol>${remainingText}<p><a href="${escapeHtml(actionUrl)}">Open owner inbox</a></p>`,
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

async function retryFailedDelivery(
  delivery: NotificationDeliveryRecord,
  token: string,
): Promise<NotificationDeliveryRecord | null> {
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
  return (await response.json()) as NotificationDeliveryRecord;
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
  if (response.status === 400 || response.status === 409) return null;
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
  if (existing) return retryFailedDelivery(existing, token);

  const created = await createPendingDelivery(userId, item, deliveryKey, token, channel).catch(() => null);
  if (created) return created;

  const raced = await findDelivery(deliveryKey, token).catch(() => null);
  return raced ? retryFailedDelivery(raced, token) : null;
}

async function sendEmail(payload: ReturnType<typeof emailPayloadForInboxItem>): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

async function sendInboxEmail(recipient: string, item: BusinessInboxItem): Promise<boolean> {
  if (!recipient) return false;
  return sendEmail(emailPayloadForInboxItem(recipient, item));
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

export async function dispatchEmailDigest(
  userId: string,
  recipient: string,
  digest: NotificationDigest,
): Promise<DeliverySummary> {
  const deliveryItem = notificationDigestDeliveryItem(digest);
  const payload = emailPayloadForDigest(recipient, digest);
  if (!deliveryItem || !payload || !digest.channels.includes("email")) {
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

  const claim = await claimDelivery(userId, deliveryItem, "email", token);
  if (!claim) return { attempted: 1, sent: 0, skipped: 1, failed: 0 };
  if (await sendEmail(payload).catch(() => false)) {
    await markDelivery(claim.id, "sent", token).catch(() => undefined);
    return { attempted: 1, sent: 1, skipped: 0, failed: 0 };
  }
  await markDelivery(claim.id, "failed", token, "Email digest provider delivery failed").catch(() => undefined);
  return { attempted: 1, sent: 0, skipped: 0, failed: 1 };
}
