"use client";

/**
 * /dashboard/front-desk/analytics — per-customer Site Analytics (W95.6.y,
 * repointing the W80.3 operator-wide surface to site-per-customer).
 *
 * Read-only. Reads /api/front-desk/analytics. Honest empty state when no site
 * is provisioned (Standard #21). Inline SVG sparkline — no charting dependency
 * (Standard #9, matching the prior W80.3 surface). Zero vendor name.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";

type Agg = { visitors: number; pageviews: number; bounce_rate: number; visit_duration_seconds: number };
type Point = { date: string; visitors: number; pageviews: number };
type Data = { hasSite: boolean; period?: string; aggregate?: Agg | null; timeseries?: Point[]; topPages?: { page: string; visitors: number }[]; topSources?: { source: string; visitors: number }[] };

function dur(s: number): string { const m = Math.floor(s / 60); return m > 0 ? `${m}m ${s % 60}s` : `${s}s`; }

function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const w = 600, h = 80, max = Math.max(1, ...points.map((p) => p.visitors));
  const d = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - (p.visitors / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "80px" }}>
      <polyline points={d} fill="none" stroke="#A07BFF" strokeWidth="2" />
    </svg>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(async (p: "7d" | "30d") => {
    setData(null);
    try {
      const res = await fetch(`/api/front-desk/analytics?period=${p}`, { headers: { Authorization: pb.authStore.token } });
      setData(res.ok ? await res.json() : { hasSite: false });
    } catch { setData({ hasSite: false }); }
  }, []);
  useEffect(() => { void load(period); }, [period, load]);

  const card = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "14px", padding: "16px" } as React.CSSProperties;

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="w-full max-w-3xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Front Desk</a>
        </header>

        <div className="flex items-center justify-between mb-5">
          <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>Site analytics</h1>
          {data?.hasSite && (
            <div className="flex gap-1 text-xs">
              {(["7d", "30d"] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 rounded-lg" style={{ background: period === p ? "rgba(91,33,232,0.15)" : "#1A1A24", border: "1px solid #2A2A38", color: period === p ? "#A07BFF" : "#9090A8" }}>
                  {p === "7d" ? "7 days" : "30 days"}
                </button>
              ))}
            </div>
          )}
        </div>

        {data === null ? <p className="text-sm" style={{ color: "#7070A0" }}>Loading…</p>
          : !data.hasSite ? (
            <div style={{ ...card, textAlign: "center", padding: "40px" }}>
              <p className="text-3xl mb-3">📈</p>
              <p className="text-sm mb-5" style={{ color: "#9090A8" }}>Site tracking isn&apos;t set up yet — your specialist can help connect your site.</p>
              <a href="/dashboard?ask=help%20me%20set%20up%20site%20tracking" className="text-sm px-4 py-2 rounded-xl btn-primary text-white font-semibold inline-block" style={{ textDecoration: "none" }}>Ask your specialist →</a>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Visitors", value: String(data.aggregate?.visitors ?? 0) },
                  { label: "Pageviews", value: String(data.aggregate?.pageviews ?? 0) },
                  { label: "Bounce rate", value: `${data.aggregate?.bounce_rate ?? 0}%` },
                  { label: "Avg. visit", value: dur(data.aggregate?.visit_duration_seconds ?? 0) },
                ].map((m) => (
                  <div key={m.label} style={card}>
                    <p className="text-xs uppercase tracking-wider" style={{ color: "#6060A0" }}>{m.label}</p>
                    <p className="text-xl font-bold mt-1" style={{ color: "#F0F0F8" }}>{m.value}</p>
                  </div>
                ))}
              </div>

              <div style={{ ...card, marginBottom: "20px" }}>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Visitor trend</p>
                <Sparkline points={data.timeseries ?? []} />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Breakdown title="Top pages" rows={(data.topPages ?? []).map((p) => ({ label: p.page || "/", value: p.visitors }))} card={card} />
                <Breakdown title="Top sources" rows={(data.topSources ?? []).map((s) => ({ label: s.source, value: s.visitors }))} card={card} />
              </div>
            </>
          )}
      </div>
    </main>
  );
}

function Breakdown({ title, rows, card }: { title: string; rows: { label: string; value: number }[]; card: React.CSSProperties }) {
  return (
    <div style={card}>
      <p className="text-xs uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>{title}</p>
      {rows.length === 0 ? <p className="text-xs" style={{ color: "#6A6A80" }}>No data yet.</p>
        : <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span className="truncate" style={{ color: "#D0D0E0" }}>{r.label}</span>
                <span style={{ color: "#9090A8" }}>{r.value}</span>
              </li>
            ))}
          </ul>}
    </div>
  );
}
