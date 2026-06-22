/**
 * W95.8 — notification event registry. The SINGLE source of truth for every
 * system→user notification: each typed event declares its audience, severity,
 * and how it renders to a title/body/href. New notifications extend this map —
 * no per-feature one-off rendering (the unified-layer principle).
 */

import { describe, it, expect } from "vitest";
import { NOTIFICATION_EVENTS, renderNotification, type NotificationType } from "../../app/api/_lib/notifications/events";

describe("notification event registry", () => {
  it("every event declares a customer/operator audience, a severity, and a render fn", () => {
    for (const [type, ev] of Object.entries(NOTIFICATION_EVENTS)) {
      expect(["customer", "operator"], `${type} audience`).toContain(ev.audience);
      expect(["info", "success", "warning"], `${type} severity`).toContain(ev.severity);
      expect(typeof ev.render).toBe("function");
    }
  });

  it("generation.ready (video) → branded title + the url as href, zero vendor names", () => {
    const r = renderNotification("generation.ready", { kind: "video", url: "https://cdn/v.mp4" });
    expect(r.title).toBe("Your video is ready");
    expect(r.href).toBe("https://cdn/v.mp4");
    expect(`${r.title} ${r.body}`.toLowerCase()).not.toContain("muapi");
  });

  it("generation.ready (image) → visual wording", () => {
    expect(renderNotification("generation.ready", { kind: "image", url: "u" }).title).toBe("Your visual is ready");
  });

  it("credits.low → warning copy pointing at pricing", () => {
    const r = renderNotification("credits.low", { remaining: 2, kind: "video" });
    expect(r.title.toLowerCase()).toContain("low");
    expect(r.href).toBe("/pricing");
    expect(r.body).toContain("2");
  });

  it("generation.failed → reassures no charge", () => {
    const r = renderNotification("generation.failed", { kind: "image" });
    expect(r.body.toLowerCase()).toContain("no credit");
  });

  it("the type union is keyed off the registry (compile-time guard)", () => {
    const t: NotificationType = "generation.ready";
    expect(NOTIFICATION_EVENTS[t]).toBeTruthy();
  });
});
