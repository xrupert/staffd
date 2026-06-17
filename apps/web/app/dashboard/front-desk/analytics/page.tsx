"use client";

/**
 * /dashboard/front-desk/analytics — Site Analytics native surface (W80.3).
 *
 * The deep view behind the Front Desk Site Analytics card: headline metrics,
 * a visitor trend (inline SVG — no charting dependency, Standard #9), and
 * source / page / country breakdowns over three fixed ranges. No vendor name
 * appears. Super-admin gated; the read route was gated in W80.1a.
 * "Make sense of this →" hands the current view to the analytics specialist
 * via the Command Center (surface→specialist — not W63/W62).
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";
import {
  analyticsRangeLabel,
  formatVisitDuration,
  buildAnalyticsSmartPrompt,
  type AnalyticsRange,
  type AnalyticsView,
} from "../../../../lib/operations";

const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px" };
const RANGES: AnalyticsRange[] = ["day", "7d", "30d"];

export default function AnalyticsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [view, setView] = useState<AnalyticsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (r: AnalyticsRange) => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/integrations/plausible?view=deep&range=${r}&pbToken=${encodeURIComponent(pb.authStore.token)}`);
      if (res.status === 503) { setView(null); setError("Analytics isn't connected yet."); return; }
      if (!res.ok) { setView(null); setError("Couldn't load analytics."); return; }
      setView((await res.json()) as AnalyticsView);
    } catch { setView(null); setError("Couldn't load analytics."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // W91 — any authenticated user; creds resolve per-user (own → operator).
    const authed = pb.authStore.isValid;
    setIsAdmin(authed);
    if (authed) void load(range);
  }, [load, range]);

  if (isAdmin === false) {
    return <Shell><div style={{ ...card, textAlign: "center", padding: "40px" }}><p className="text-sm" style={{ color: "#9090A8" }}>Sign in to see your site analytics.</p></div></Shell>;
  }

  return (
    <Shell>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>Site Analytics</h1>
        <div className="flex gap-1.5">
          {RANGES.map((r) => {
            const on = r === range;
            return (
              <button key={r} onClick={() => setRange(r)} className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ background: on ? "rgba(91,33,232,0.15)" : "#1A1A24", border: `1px solid ${on ? "rgba(91,33,232,0.5)" : "#2A2A38"}`, color: on ? "#A07BFF" : "#7070A0", cursor: "pointer" }}>
                {analyticsRangeLabel(r)}
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="px-4 py-3 rounded-xl text-xs mb-4" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}>{error}{error.includes("connected") && <> <a href="/dashboard/settings#connect-your-tools" style={{ color: "#A07BFF", textDecoration: "underline" }}>Connect your tools →</a></>}</div>}

      {loading ? <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
        : !view ? null
        : (
        <div className="flex flex-col gap-4">
          {/* Headline */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Visitors" value={view.headline.visitors.toLocaleString()} />
            <Metric label="Pageviews" value={view.headline.pageviews.toLocaleString()} />
            <Metric label="Bounce rate" value={`${view.headline.bounceRate}%`} />
            <Metric label="Avg. visit" value={formatVisitDuration(view.headline.visitDuration)} />
          </div>

          {/* Visitor trend */}
          <div style={card}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Visitors · {analyticsRangeLabel(view.range)}</p>
            <Sparkline points={view.timeseries.map((t) => t.visitors)} />
          </div>

          {/* Breakdowns */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <Breakdown title="Top sources" rows={view.sources.map((s) => ({ name: s.name, value: s.visitors }))} unit="visitors" />
            <Breakdown title="Top pages" rows={view.pages.map((p) => ({ name: p.name, value: p.pageviews }))} unit="views" />
            <Breakdown title="Top countries" rows={view.countries.map((c) => ({ name: c.name, value: c.visitors }))} unit="visitors" />
          </div>

          {/* Augmentation — in-context, no leaving the page mentally */}
          <div className="flex justify-end">
            <a href={`/dashboard?ask=${encodeURIComponent(buildAnalyticsSmartPrompt(view))}`} className="text-xs px-4 py-2 rounded-lg" style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF", textDecoration: "none" }}>✨ Make sense of this →</a>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={card}><p className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem", lineHeight: 1 }}>{value}</p><p className="text-xs mt-1.5" style={{ color: "#5A5A70" }}>{label}</p></div>;
}

/** Inline SVG area sparkline — no charting dependency (Standard #9). */
function Sparkline({ points }: { points: number[] }) {
  const W = 640, H = 120, P = 6;
  if (points.length === 0) return <p className="text-xs" style={{ color: "#5A5A70" }}>No data for this range.</p>;
  const max = Math.max(...points, 1);
  const n = points.length;
  const x = (i: number) => n === 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Visitor trend">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5B21E8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5B21E8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={line} fill="none" stroke="#A07BFF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2" fill="#A07BFF" />)}
    </svg>
  );
}

function Breakdown({ title, rows, unit }: { title: string; rows: { name: string; value: number }[]; unit: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={card}>
      <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>{title}</p>
      {rows.length === 0 ? <p className="text-xs" style={{ color: "#5A5A70" }}>No data yet.</p> : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <div key={i}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs truncate" style={{ color: "#D0D0E8" }}>{r.name}</span>
                <span className="text-xs flex-shrink-0" style={{ color: "#7070A0" }}>{r.value.toLocaleString()} {unit}</span>
              </div>
              <div style={{ height: "4px", borderRadius: "2px", background: "#1A1A24", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(r.value / max) * 100}%`, background: "rgba(91,33,232,0.6)" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`, backgroundSize: "64px 64px" }} />
      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Front Desk</a>
        </header>
        {children}
      </div>
    </main>
  );
}
