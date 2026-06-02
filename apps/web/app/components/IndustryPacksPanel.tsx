"use client";

/**
 * Settings → Industry Packs panel (Phase 8).
 *
 * Lists every available pack with status (Active / Add). Adding initiates a
 * Stripe Checkout via /api/stripe/checkout-pack. Cancellation flows through
 * the Stripe Customer Portal (existing /api/stripe/portal).
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type PackCatalogEntry = {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentCount: number;
  departments: string[];
  active: boolean;
};

const DEPT_SHORT: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  "paid-media": "Paid Media",
  design: "Design",
  reputation: "Reputation",
  ceo: "CEO",
};

export default function IndustryPacksPanel() {
  const [packs, setPacks] = useState<PackCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    try {
      const res = await fetch(`/api/packs${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  async function buyPack(packId: string) {
    setBusyPackId(packId);
    setError(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string | undefined) ?? "";
      const res = await fetch("/api/stripe/checkout-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, userEmail, packId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "checkout_failed");
        setBusyPackId(null);
      }
    } catch {
      setError("network_error");
      setBusyPackId(null);
    }
  }

  async function openPortal() {
    setBusyPackId("__portal__");
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setBusyPackId(null);
    } catch {
      setBusyPackId(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Industry packs</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  const activeCount = packs.filter((p) => p.active).length;

  return (
    <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Industry packs</h2>
          <p className="text-xs mt-1" style={{ color: "#9090A8" }}>
            Vertical specialists added to your existing departments — $19/mo each.
            {activeCount > 0 && ` ${activeCount} active.`}
          </p>
        </div>
        {activeCount > 0 && (
          <button
            onClick={() => void openPortal()}
            disabled={busyPackId === "__portal__"}
            className="text-xs font-medium transition-colors"
            style={{ color: "#A07BFF", opacity: busyPackId === "__portal__" ? 0.5 : 1 }}
          >
            Manage subscriptions →
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {packs.map((p) => {
          const isBusy = busyPackId === p.id;
          return (
            <div
              key={p.id}
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{
                background: p.active ? "rgba(91,33,232,0.06)" : "#0D0D16",
                border: `1px solid ${p.active ? "rgba(91,33,232,0.3)" : "#2A2A38"}`,
              }}
            >
              <div className="flex items-start gap-3">
                <span style={{ fontSize: "22px" }}>{p.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{p.name}</p>
                    {p.active && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-md flex-shrink-0"
                        style={{ background: "rgba(34,197,94,0.10)", color: "#22C55E", border: "1px solid rgba(34,197,94,0.25)" }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-1" style={{ color: "#9090A8", lineHeight: 1.5 }}>
                    {p.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-auto">
                <p className="text-xs" style={{ color: "#5A5A70" }}>
                  {p.agentCount} specialists · {p.departments.length} departments
                </p>
                {p.active ? (
                  <span className="text-xs" style={{ color: "#7070A0" }}>$19/mo</span>
                ) : (
                  <button
                    onClick={() => void buyPack(p.id)}
                    disabled={busyPackId !== null}
                    className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                    style={{ opacity: busyPackId !== null && !isBusy ? 0.3 : 1 }}
                  >
                    {isBusy ? "Opening Stripe…" : "Add — $19/mo"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-xs mt-3" style={{ color: "#EF4444" }}>Couldn't open checkout: {error}</p>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
};
