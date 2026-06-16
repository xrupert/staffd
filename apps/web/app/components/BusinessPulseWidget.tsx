"use client";

/**
 * BusinessPulseWidget — STAFFD's own live revenue pulse for the operator.
 *
 * Reads /api/connectors/stripe (super-admin gated) to show MRR + active
 * subscriptions from STAFFD's Stripe. This is the operator's metric (how is
 * STAFFD doing), so it lives on the admin dashboard — never a per-customer
 * surface.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type Pulse = { activeSubscriptions: number; mrr: number; currency: string };

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString()}`;
  }
}

export default function BusinessPulseWidget() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/connectors/stripe?pbToken=${encodeURIComponent(token)}`);
      if (!res.ok) {
        setError(res.status === 503 ? "Billing not connected." : res.status === 403 || res.status === 401 ? "Super-admin only." : "Couldn't load revenue.");
        setPulse(null);
        return;
      }
      setPulse((await res.json()) as Pulse);
    } catch {
      setError("Couldn't reach billing.");
      setPulse(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
          STAFFD Pulse
        </h2>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-xs transition-colors hover:text-white"
          style={{ color: "#A07BFF", background: "none", border: "none", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="px-4 py-3 rounded-xl text-xs" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}>
          {error}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={cardStyle}>
            <p className="text-xs mb-1" style={{ color: "#5A5A70" }}>Monthly recurring revenue</p>
            <p className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1 }}>
              {loading || !pulse ? "—" : fmtMoney(pulse.mrr, pulse.currency)}
            </p>
          </div>
          <div style={cardStyle}>
            <p className="text-xs mb-1" style={{ color: "#5A5A70" }}>Active subscriptions</p>
            <p className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1 }}>
              {loading || !pulse ? "—" : pulse.activeSubscriptions.toLocaleString()}
            </p>
          </div>
        </div>
      )}
      <p className="text-xs mt-3" style={{ color: "#5A5A70" }}>
        Live from your billing (annual plans normalized to monthly). Operator-only.
      </p>
    </section>
  );
}
