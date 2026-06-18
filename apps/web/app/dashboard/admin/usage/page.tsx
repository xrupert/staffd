"use client";

/**
 * /dashboard/admin/usage — Super-Admin Usage Dashboard (W92).
 *
 * Fleet-wide visibility across all users: Users / Departments / Integrations
 * / Workflows. Super-admin gated by the parent /dashboard/admin layout (which
 * also audits page views). Read-only (admin actions = W93). Operator + comp
 * rows are visibly marked so dogfood activity stays separable from customer
 * signal — we mark, never filter. Drill-in shows metadata only and is logged.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";
import { usageBadge, type UserType } from "../../../api/_lib/usage";

const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px" };
const tabBtn = (on: boolean): React.CSSProperties => ({ background: on ? "rgba(91,33,232,0.15)" : "#1A1A24", border: `1px solid ${on ? "rgba(91,33,232,0.5)" : "#2A2A38"}`, color: on ? "#A07BFF" : "#7070A0", borderRadius: "10px", padding: "8px 14px", fontSize: "13px", cursor: "pointer" });

type Roster = { id: string; email: string; type: UserType; plan: string; lastActivity: string | null; docCount: number; churn: string; isOperator: boolean; plausibleSiteId: string | null };
type Usage = {
  users: { total: number; byType: Record<string, number>; byPlan: Record<string, number>; activity: Record<string, number>; churn: { expired: number; expiring: number }; roster: Roster[] };
  departments: { byDept: { department: string; count: number; lastAt: string }[]; specialists: { agent_name: string; department: string; count: number }[] };
  integrations: { health: { key: string; label: string; connected: boolean }[]; outcomes: { decision_kind: string; count: number }[]; note: string };
  workflows: { byStatus: Record<string, number>; taskSuccess: { succeeded: number; total: number; rate: number }; recentTransitions: { detail: string; at: string; user: string }[]; velocity7d: { date: string; count: number }[]; mirrorRetry: Record<string, number> };
};
type Detail = { user: { id: string; email: string; type: string; plan: string; created: string; lastActivity: string | null }; counts: { documents: number; threads: number; workflows: number; imageCredits: number; videoCredits: number; agentCreditsTopup: number }; outcomes: { decision_kind: string; count: number }[] };

type Tab = "users" | "departments" | "integrations" | "workflows";

export default function UsageDashboard() {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("users");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/admin/usage?pbToken=${encodeURIComponent(pb.authStore.token)}`);
        if (!res.ok) { setError(res.status === 403 ? "Super-admin only." : "Couldn't load usage."); return; }
        setData((await res.json()) as Usage);
      } catch { setError("Couldn't load usage."); }
    })();
  }, []);

  const openUser = useCallback(async (id: string) => {
    setDetailLoading(true); setDetail(null);
    try {
      const res = await fetch(`/api/admin/usage/${encodeURIComponent(id)}?pbToken=${encodeURIComponent(pb.authStore.token)}`);
      if (res.ok) setDetail((await res.json()) as Detail);
    } finally { setDetailLoading(false); }
  }, []);

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <a href="/dashboard/admin"><Image src="/logo-light.png" alt="STAFFD" width={86} height={38} style={{ objectFit: "contain" }} /></a>
        <a href="/dashboard/admin" className="text-xs hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Admin</a>
      </header>
      <h1 className="font-bold mb-1" style={{ color: "#F0F0F8", fontSize: "1.6rem" }}>Usage</h1>
      <p className="text-sm mb-5" style={{ color: "#7070A0" }}>Fleet-wide activity across all users. Read-only.</p>

      {error && <div style={{ ...card, color: "#F59E0B" }}>{error}</div>}
      {!error && !data && <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>}

      {data && (
        <>
          <div className="flex gap-2 mb-5 flex-wrap">
            {(["users", "departments", "integrations", "workflows"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={tabBtn(t === tab)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>

          {tab === "users" && <UsersTab d={data.users} onOpen={openUser} />}
          {tab === "departments" && <DeptTab d={data.departments} />}
          {tab === "integrations" && <IntegrationsTab d={data.integrations} />}
          {tab === "workflows" && <WorkflowsTab d={data.workflows} />}
        </>
      )}

      {(detail || detailLoading) && (
        <DrillIn detail={detail} loading={detailLoading} onClose={() => { setDetail(null); setDetailLoading(false); }} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div style={card}><p className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem", lineHeight: 1 }}>{value}</p><p className="text-xs mt-1.5" style={{ color: "#5A5A70" }}>{label}</p></div>;
}

function UsersTab({ d, onOpen }: { d: Usage["users"]; onOpen: (id: string) => void }) {
  // W95.6.y — operator-side Plausible site provisioning. The CE has no Sites
  // API, so the operator creates the site manually then stores its id here.
  // Local roster state so saves/clears reflect immediately without a refetch.
  const [roster, setRoster] = useState<Roster[]>(d.roster);
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const save = useCallback(async (userId: string, siteId: string) => {
    setBusy(true);
    try {
      const trimmed = siteId.trim();
      const res = await fetch(`/api/admin/plausible/${encodeURIComponent(userId)}`, {
        method: trimmed ? "POST" : "DELETE",
        headers: { Authorization: pb.authStore.token, "Content-Type": "application/json" },
        body: trimmed ? JSON.stringify({ site_id: trimmed }) : undefined,
      });
      if (res.ok) {
        setRoster((rs) => rs.map((r) => (r.id === userId ? { ...r, plausibleSiteId: trimmed || null } : r)));
        setEditing(null);
      }
    } finally { setBusy(false); }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total users" value={d.total} />
        <Stat label="Active (7d)" value={d.activity.active7 ?? 0} />
        <Stat label="Active (30d)" value={(d.activity.active7 ?? 0) + (d.activity.active30 ?? 0)} />
        <Stat label="Dormant" value={(d.activity.dormant ?? 0) + (d.activity.never ?? 0)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Customers" value={d.byType.customer ?? 0} />
        <Stat label="Comp" value={d.byType.comp ?? 0} />
        <Stat label="Churned (expired)" value={d.churn.expired} />
        <Stat label="Expiring (<14d)" value={d.churn.expiring} />
      </div>
      <div style={card}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>Roster</p>
          <p className="text-xs" style={{ color: "#5A5A70" }}>{Object.entries(d.byPlan).filter(([, n]) => n > 0).map(([p, n]) => `${p}: ${n}`).join(" · ")}</p>
        </div>
        <p className="text-xs mb-2" style={{ color: "#5A5A70" }}>
          <span style={{ color: "#22C55E" }}>●</span> = site analytics provisioned. Click the dot to set/clear a customer&apos;s Plausible site id (operator creates the site manually — there&apos;s no Sites API).
        </p>
        <div className="flex flex-col gap-1">
          {roster.map((u) => {
            const badge = usageBadge(u.type);
            const hasSite = !!u.plausibleSiteId;
            const isEditing = editing === u.id;
            return (
              <div key={u.id} className="flex flex-col rounded-lg" style={{ background: u.isOperator ? "rgba(91,33,232,0.05)" : "transparent", border: "1px solid #1E1E2A" }}>
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <button onClick={() => onOpen(u.id)} className="text-left min-w-0 flex items-center gap-2 flex-1" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {badge && <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${badge.color}22`, color: badge.color, border: `1px solid ${badge.color}55` }}>{badge.label}</span>}
                    <span className="text-xs truncate" style={{ color: "#D0D0E8" }}>{u.email}</span>
                  </button>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs" style={{ color: "#5A5A70" }}>{u.plan} · {u.docCount} docs · {u.lastActivity ? new Date(u.lastActivity).toLocaleDateString() : "never"}</span>
                    <button
                      onClick={() => { setEditing(isEditing ? null : u.id); setVal(u.plausibleSiteId ?? ""); }}
                      title={hasSite ? `Site: ${u.plausibleSiteId}` : "No site analytics — click to provision"}
                      className="text-sm flex-shrink-0"
                      style={{ background: "none", border: "none", cursor: "pointer", color: hasSite ? "#22C55E" : "#3A3A4A", lineHeight: 1 }}
                    >●</button>
                  </span>
                </div>
                {isEditing && (
                  <div className="flex items-center gap-2 px-3 pb-2.5">
                    <input
                      value={val}
                      onChange={(e) => setVal(e.target.value)}
                      placeholder="plausible site id (e.g. acme.com)"
                      className="text-xs flex-1 rounded-lg px-2.5 py-1.5"
                      style={{ background: "#0E0E16", border: "1px solid #2A2A38", color: "#D0D0E8", outline: "none" }}
                    />
                    <button onClick={() => void save(u.id, val)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg btn-primary text-white font-semibold" style={{ opacity: busy ? 0.5 : 1 }}>Save</button>
                    {hasSite && <button onClick={() => void save(u.id, "")} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F59E0B", opacity: busy ? 0.5 : 1, cursor: "pointer" }}>Clear</button>}
                    <button onClick={() => setEditing(null)} className="text-xs px-2 py-1.5 rounded-lg" style={{ background: "none", border: "none", color: "#5A5A70", cursor: "pointer" }}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-xs truncate" style={{ color: "#D0D0E8" }}>{r.label}</span>
            <span className="text-xs flex-shrink-0" style={{ color: "#7070A0" }}>{r.value}</span>
          </div>
          <div style={{ height: "5px", borderRadius: "3px", background: "#1A1A24", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(r.value / max) * 100}%`, background: "rgba(91,33,232,0.6)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DeptTab({ d }: { d: Usage["departments"] }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Output by department</p>
        {d.byDept.length === 0 ? <p className="text-xs" style={{ color: "#5A5A70" }}>No documents yet.</p> : <Bars rows={d.byDept.map((x) => ({ label: x.department, value: x.count }))} />}
      </div>
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Specialist leaderboard</p>
        {d.specialists.length === 0 ? <p className="text-xs" style={{ color: "#5A5A70" }}>No documents yet.</p> : (
          <div className="flex flex-col gap-2">
            {d.specialists.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: "#D0D0E8" }}>{s.agent_name} <span style={{ color: "#5A5A70" }}>· {s.department}</span></span>
                <span className="text-xs" style={{ color: "#7070A0" }}>{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IntegrationsTab({ d }: { d: Usage["integrations"] }) {
  return (
    <div className="flex flex-col gap-4">
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Operator integration health</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {d.health.map((h) => (
            <div key={h.key} className="rounded-lg p-3" style={{ background: "#1A1A24", border: "1px solid #2A2A38" }}>
              <p className="text-xs" style={{ color: "#D0D0E8" }}>{h.label}</p>
              <p className="text-xs mt-1" style={{ color: h.connected ? "#22C55E" : "#5A5A70" }}>{h.connected ? "● Connected" : "○ Not connected"}</p>
            </div>
          ))}
        </div>
      </div>
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Outcomes (fleet-wide)</p>
        {d.outcomes.length === 0 ? <p className="text-xs" style={{ color: "#5A5A70" }}>No recorded outcomes yet.</p> : <Bars rows={d.outcomes.map((o) => ({ label: o.decision_kind, value: o.count }))} />}
        <p className="text-xs mt-3" style={{ color: "#5A5A70" }}>{d.note}</p>
      </div>
    </div>
  );
}

function VelocitySvg({ points }: { points: { date: string; count: number }[] }) {
  const W = 620, H = 90, P = 6;
  const max = Math.max(...points.map((p) => p.count), 1);
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Transition velocity, 7 days">
      <path d={`${line} L${x(n - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`} fill="rgba(91,33,232,0.18)" />
      <path d={line} fill="none" stroke="#A07BFF" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.count)} r="2" fill="#A07BFF" />)}
    </svg>
  );
}

function WorkflowsTab({ d }: { d: Usage["workflows"] }) {
  const s = d.byStatus;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Pending" value={s.pending ?? 0} />
        <Stat label="Running" value={s.running ?? 0} />
        <Stat label="Completed" value={s.completed ?? 0} />
        <Stat label="Failed" value={s.failed ?? 0} />
        <Stat label="Partial" value={s.partial ?? 0} />
      </div>
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#6060A0" }}>Task success rate</p>
        <p className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>{d.taskSuccess.rate}% <span className="text-xs font-normal" style={{ color: "#5A5A70" }}>({d.taskSuccess.succeeded}/{d.taskSuccess.total} tasks)</span></p>
      </div>
      {/* W95.2 — vendor mirror-retry health (Model B3 mirror discipline) */}
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Vendor mirror retries</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Pending" value={d.mirrorRetry?.pending ?? 0} />
          <Stat label="Retrying" value={d.mirrorRetry?.retrying ?? 0} />
          <Stat label="Succeeded" value={d.mirrorRetry?.succeeded ?? 0} />
          <Stat label="Failed" value={d.mirrorRetry?.failed ?? 0} />
        </div>
        <p className="text-xs mt-3" style={{ color: "#5A5A70" }}>Re-syncs of STAFFD-native records to the operator-shared vendor backends. Failed = exhausted 3 retries — needs attention.</p>
      </div>
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Transition velocity · last 7 days</p>
        <VelocitySvg points={d.velocity7d} />
      </div>
      <div style={card}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Recent transitions</p>
        {d.recentTransitions.length === 0 ? <p className="text-xs" style={{ color: "#5A5A70" }}>No transitions yet.</p> : (
          <div className="flex flex-col gap-1.5">
            {d.recentTransitions.slice(0, 12).map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: "#D0D0E8" }}>{t.detail}</span>
                <span className="text-xs flex-shrink-0" style={{ color: "#5A5A70" }}>{t.at ? new Date(t.at).toLocaleString() : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DrillIn({ detail, loading, onClose }: { detail: Detail | null; loading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div style={{ ...card, maxWidth: "420px", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        {loading || !detail ? <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p> : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-sm" style={{ color: "#F0F0F8" }}>{detail.user.email}</p>
              <button onClick={onClose} className="text-xs" style={{ color: "#7070A0", background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
            <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>{detail.user.type} · {detail.user.plan} · joined {new Date(detail.user.created).toLocaleDateString()} · last active {detail.user.lastActivity ? new Date(detail.user.lastActivity).toLocaleDateString() : "never"}</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Stat label="Docs" value={detail.counts.documents} />
              <Stat label="Threads" value={detail.counts.threads} />
              <Stat label="Workflows" value={detail.counts.workflows} />
            </div>
            <p className="text-xs" style={{ color: "#7070A0" }}>Credits — images {detail.counts.imageCredits} · videos {detail.counts.videoCredits} · agent top-up {detail.counts.agentCreditsTopup}</p>
            {detail.outcomes.length > 0 && (
              <p className="text-xs mt-2" style={{ color: "#7070A0" }}>Outcomes — {detail.outcomes.map((o) => `${o.decision_kind}: ${o.count}`).join(" · ")}</p>
            )}
            <p className="text-xs mt-4" style={{ color: "#4A4A65" }}>Metadata only — no message or document content. This view is logged.</p>
          </>
        )}
      </div>
    </div>
  );
}
