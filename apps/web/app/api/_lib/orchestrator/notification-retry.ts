export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 4;
export const NOTIFICATION_DELIVERY_CLAIM_LEASE_MS = 15 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export type RetryableNotificationDelivery = {
  status?: "pending" | "sent" | "failed";
  attempts?: number;
  updated?: string;
};

export function notificationRetryDelayMs(attempts: number): number {
  const completedAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** (completedAttempts - 1), MAX_RETRY_DELAY_MS);
}

export function notificationDeliveryRetryable(
  delivery: RetryableNotificationDelivery,
  now = new Date(),
): boolean {
  if (delivery.status !== "failed" && delivery.status !== "pending") return false;
  const attempts = Math.max(1, Math.floor(delivery.attempts ?? 1));
  if (attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS) return false;
  const updatedAt = new Date(delivery.updated ?? "");
  if (!Number.isFinite(updatedAt.getTime())) return false;
  const elapsedMs = now.getTime() - updatedAt.getTime();
  if (elapsedMs < 0) return false;
  if (delivery.status === "pending") return elapsedMs >= NOTIFICATION_DELIVERY_CLAIM_LEASE_MS;
  return elapsedMs >= notificationRetryDelayMs(attempts);
}
