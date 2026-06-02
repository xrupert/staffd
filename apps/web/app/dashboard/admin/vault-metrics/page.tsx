"use client";

/**
 * /dashboard/admin/vault-metrics — Phase 31.
 *
 * Operator-facing observability page. Renders a snapshot of system health:
 * queue depths, doc throughput, brief delivery rate, conversation activity,
 * push subscription count, total users.
 *
 * Auth is gated server-side (the API returns 403 if your email isn't
 * ADMIN_EMAIL). The page also hides itself gracefully on 403 so non-admins
 * who guess the URL see "not_found".
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";

type Metrics = {
  generatedAt: string;
  queue: { pending: number; running: number; dead: number; completedLast24h: number };
  documents: { total: number; created24h: number; activeWriters7d: number };
  briefs: { total: number; pushed: number; deliveryRate: number; created7d: number };
  conversations: { total: number; created24h: number; created7d: number };
  pushSubscriptions: { total: number };
  users: { total: number };
};

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

const statLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#7070A0",
  marginBottom: "4px",
};

const statValue: React.CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "#F0F0F8",
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
};

const statSub: React.CSSProperties = {
  fontSize: "11px",
  color: "#5A5A70",
  marginTop: "4px",
};

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "warn" | "danger" | "ok" }) {
  const toneColor =
    tone === "danger" ? "#EF4444" :
    tone === "warn"   ? "#F59E0B" :
    tone === "ok"     ? "#22C55E" :
                         "#F0F0F8";
  return (
    <div>
      <p style={statLabel}>{label}</p>
      <p style={{ ...statValue, color: toneColor }}>{value}</p>
      {sub && <p style={statSub}>{sub}</p>}
    </div>
  );
}

export default function VaultMetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    setLoading(true);
    setError(null);
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/admin/vault-metrics?pbToken=${encodeURIComponent(token)}`);
      if (res.status === 403 || res.status === 401) {
        setError("not_authorized");
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `error_${res.status}`);
      } else {
        const data = await res.json();
        setMetrics(data as Metrics);
      }
    } catch {
      setError("network_error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-10">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>
            ← Dashboard
          </a>
        </header>

        <div className="mb-8 flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Operator</p>
            <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              Vault Metrics
            </h1>
            <p className="text-xs mt-2" style={{ color: "#5A5A70" }}>
              Cross-tenant system health. Counts include all users.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-xs font-medium px-3 py-2 rounded-lg"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error === "not_authorized" && (
          <div className="rounded-2xl p-6" style={cardStyle}>
            <p className="text-sm" style={{ color: "#EF4444" }}>
              This page is operator-only. Configure <code style={{ color: "#A07BFF" }}>ADMIN_EMAIL</code> in Vercel and sign in as that account to access it.
            </p>
          </div>
        )}
        {error && error !== "not_authorized" && (
          <div className="rounded-2xl p-6" style={cardStyle}>
            <p className="text-sm" style={{ color: "#EF4444" }}>Could not load metrics: {error}</p>
          </div>
        )}

        {metrics && (
          <div className="flex flex-col gap-5">
            {/* Vault ingestion queue */}
            <section style={cardStyle}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F8" }}>Vault ingestion queue</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
                <Stat
                  label="Pending"
                  value={metrics.queue.pending}
                  tone={metrics.queue.pending > 100 ? "warn" : undefined}
                  sub="awaiting next worker tick"
                />
                <Stat label="Running" value={metrics.queue.running} sub="in-flight" />
                <Stat
                  label="Dead"
                  value={metrics.queue.dead}
                  tone={metrics.queue.dead > 0 ? "danger" : "ok"}
                  sub="failed after 5 attempts"
                />
                <Stat label="Completed (24h)" value={metrics.queue.completedLast24h} tone="ok" sub="throughput" />
              </div>
            </section>

            {/* Documents */}
            <section style={cardStyle}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F8" }}>Documents</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                <Stat label="Total" value={metrics.documents.total.toLocaleString()} />
                <Stat label="Created (24h)" value={metrics.documents.created24h} sub="generation throughput" />
                <Stat label="Created (7d)" value={metrics.documents.activeWriters7d} sub="weekly throughput" />
              </div>
            </section>

            {/* Briefs */}
            <section style={cardStyle}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F8" }}>Morning Briefs</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
                <Stat label="Total compiled" value={metrics.briefs.total} />
                <Stat label="Pushed" value={metrics.briefs.pushed} />
                <Stat
                  label="Delivery rate"
                  value={`${metrics.briefs.deliveryRate}%`}
                  tone={metrics.briefs.deliveryRate >= 80 ? "ok" : metrics.briefs.deliveryRate >= 50 ? "warn" : "danger"}
                />
                <Stat label="Created (7d)" value={metrics.briefs.created7d} />
              </div>
            </section>

            {/* Conversations */}
            <section style={cardStyle}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F8" }}>Conversations</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                <Stat label="Threads (total)" value={metrics.conversations.total.toLocaleString()} />
                <Stat label="Threads (24h)" value={metrics.conversations.created24h} />
                <Stat label="Threads (7d)" value={metrics.conversations.created7d} />
              </div>
            </section>

            {/* Users + push */}
            <section style={cardStyle}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "#F0F0F8" }}>Users + push</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                <Stat label="Users (total)" value={metrics.users.total.toLocaleString()} />
                <Stat label="Push subscriptions" value={metrics.pushSubscriptions.total.toLocaleString()} sub="active devices" />
                <Stat
                  label="Push opt-in rate"
                  value={metrics.users.total > 0 ? `${Math.round((metrics.pushSubscriptions.total / metrics.users.total) * 100)}%` : "—"}
                />
              </div>
            </section>

            <p className="text-xs text-right" style={{ color: "#3A3A55" }}>
              Snapshot at {new Date(metrics.generatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
