/**
 * Notification event registry (W95.8) — PURE, client-safe. The single source of
 * truth for system→user notifications (the unified-layer principle: typed events
 * × audience × severity × render, NOT per-feature one-offs).
 *
 * Each event declares:
 *   - audience: "customer" (persisted to `notifications`, shown in the bell) or
 *     "operator" (routed to the structured-log / future super_admin_signals path,
 *     NOT the customer inbox).
 *   - severity: drives the bell's accent (info/success/warning).
 *   - render(payload) → { title, body, href? }: customer-facing copy. ZERO vendor
 *     names — notifications speak in STAFFD's voice.
 *
 * Adding a notification = add an entry here + a producer that calls notifyUser.
 */

export type NotificationAudience = "customer" | "operator";
export type NotificationSeverity = "info" | "success" | "warning";

export type NotificationEvent = {
  audience: NotificationAudience;
  severity: NotificationSeverity;
  render: (payload: Record<string, unknown>) => { title: string; body: string; href?: string };
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const NOTIFICATION_EVENTS = {
  "generation.ready": {
    audience: "customer",
    severity: "success",
    render: (p) => ({
      title: p.kind === "video" ? "Your video is ready" : "Your visual is ready",
      body: p.kind === "video" ? "Your video finished generating — tap to watch it." : "Your image finished generating — tap to view it.",
      href: str(p.url),
    }),
  },
  "generation.failed": {
    audience: "customer",
    severity: "warning",
    render: (p) => ({
      title: p.kind === "video" ? "Video didn't finish" : "Image didn't finish",
      body: "The generation didn't complete — no credits were charged. Please try again.",
    }),
  },
  "workflow.completed": {
    audience: "customer",
    severity: "success",
    render: (p) => ({
      title: "Your workflow is done",
      body: "Every step finished — your team wrapped it up. Tap to see the result.",
      href: str(p.docId) ? `/doc/${str(p.docId)}` : undefined,
    }),
  },
  "credits.low": {
    audience: "customer",
    severity: "warning",
    render: (p) => ({
      title: "You're low on credits",
      body: `You have ${typeof p.remaining === "number" ? p.remaining : 0} ${str(p.kind) ?? ""} credit${p.remaining === 1 ? "" : "s"} left.`.replace(/\s+/g, " ").trim(),
      href: "/pricing",
    }),
  },
} as const satisfies Record<string, NotificationEvent>;

export type NotificationType = keyof typeof NOTIFICATION_EVENTS;

export function renderNotification(type: NotificationType, payload: Record<string, unknown>): { title: string; body: string; href?: string } {
  return NOTIFICATION_EVENTS[type].render(payload);
}
