"use client";

/**
 * BusinessPulseWidget — STAFFD's own live revenue pulse for the operator.
 *
 * The Stripe-backed connector this widget read was removed (SA decision,
 * 2026-06-25 — Stripe is gone, a real provider isn't picked yet). Shows a
 * clean "not connected" state until a BillingProvider-backed connector
 * replaces it.
 */

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

export default function BusinessPulseWidget() {
  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
          STAFFD Pulse
        </h2>
      </div>
      <div style={cardStyle}>
        <p className="text-xs" style={{ color: "#5A5A70" }}>
          No billing provider connected. Revenue metrics will appear here once one is.
        </p>
      </div>
    </section>
  );
}
