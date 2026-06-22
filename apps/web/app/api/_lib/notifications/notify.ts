/**
 * notifyUser (W95.8) — the producer entrypoint for system→user notifications.
 * Server-only (writes via the admin token). BEST-EFFORT by design: it swallows
 * every error and returns void, so a notification failure can never break the
 * flow that produced it (e.g. completing a paid generation). Customer-audience
 * events persist to `notifications` (shown in the bell); operator-audience
 * events are skipped here — they route to the structured-log / future
 * super_admin_signals path instead.
 */

import { adminHeaders } from "../pb";
import { NOTIFICATION_EVENTS, renderNotification, type NotificationType } from "./events";

export async function notifyUser(
  pb: string,
  token: string,
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    if (!userId) return; // leak-guard — never write an unscoped notification
    const ev = NOTIFICATION_EVENTS[type];
    if (!ev || ev.audience !== "customer") return; // operator events route elsewhere
    const { title, body, href } = renderNotification(type, payload);
    await fetch(`${pb}/api/collections/notifications/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ user: userId, type, title, body, href: href ?? "", severity: ev.severity, read: false }),
    });
  } catch {
    /* notifications are best-effort — never break the producing flow */
  }
}
