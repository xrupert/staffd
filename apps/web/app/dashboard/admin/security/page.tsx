"use client";

/**
 * /dashboard/admin/security — PR-Bundle-10-Security-Audit.
 *
 * Operator-facing dashboard for multi-tenant row-rule verification. Mirrors
 * the /dashboard/admin/vault-metrics surface pattern (Bundle 31): server-side
 * 403 gate via /api/admin/verify-row-rules; client renders status table +
 * graceful "operator-only" fallback when access denied.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";

type RuleSet = {
  list: string | null;
  view: string | null;
  create: string | null;
  update: string | null;
  delete: string | null;
};

type CollectionStatus = "✅" | "🔴" | "ℹ️";

type CollectionReport = {
  name: string;
  status: CollectionStatus;
  expected_rules: RuleSet;
  actual_rules: RuleSet | null;
  gaps: string[];
  note?: string;
};

type VerifyReport = {
  timestamp: string;
  collections: CollectionReport[];
  overall_status: CollectionStatus;
  gap_count: number;
  collections_checked: number;
};

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

const tableHeader: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#7070A0",
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #2A2A38",
};

const tableCell: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #1E1E2A",
  fontSize: "13px",
  color: "#D0D0E8",
  verticalAlign: "top",
};

function statusColor(status: CollectionStatus): string {
  return status === "✅" ? "#22C55E" : status === "🔴" ? "#EF4444" : "#A07BFF";
}

function statusBg(status: CollectionStatus): string {
  return status === "✅"
    ? "rgba(34,197,94,0.10)"
    : status === "🔴"
      ? "rgba(239,68,68,0.10)"
      : "rgba(160,123,255,0.10)";
}

export default function SecurityAuditPage() {
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!pb.authStore.isValid) {
      window.location.href = "/auth/login";
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/admin/verify-row-rules?pbToken=${encodeURIComponent(token)}`);
      if (res.status === 403 || res.status === 401) {
        setError("not_authorized");
      } else if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `error_${res.status}`);
      } else {
        const data = (await res.json()) as VerifyReport;
        setReport(data);
      }
    } catch {
      setError("network_error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

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
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>
              Operator
            </p>
            <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              Multi-Tenant Security
            </h1>
            <p className="text-xs mt-2" style={{ color: "#5A5A70" }}>
              Live PocketBase row-rule verification across the 19-collection baseline + templates. Read-only — fixes happen in PB admin UI per runbook.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="text-xs font-medium px-3 py-2 rounded-lg"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "Refreshing…" : "Refresh Status"}
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
            <p className="text-sm" style={{ color: "#EF4444" }}>Could not load security report: {error}</p>
          </div>
        )}

        {report && (
          <div className="flex flex-col gap-5">
            {/* Overall status banner */}
            <section
              className="rounded-2xl p-5 flex items-center justify-between"
              style={{
                background: statusBg(report.overall_status),
                border: `1px solid ${statusColor(report.overall_status)}40`,
              }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: statusColor(report.overall_status) }}>
                  Overall Status
                </p>
                <p className="text-base font-semibold" style={{ color: "#F0F0F8" }}>
                  {report.overall_status === "✅"
                    ? "All collections secure"
                    : `${report.gap_count} gap${report.gap_count === 1 ? "" : "s"} detected across ${report.collections.filter((c) => c.status === "🔴").length} collection${report.collections.filter((c) => c.status === "🔴").length === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs" style={{ color: "#5A5A70" }}>Snapshot at</p>
                <p className="text-xs font-mono" style={{ color: "#9090A8" }}>
                  {new Date(report.timestamp).toLocaleString()}
                </p>
              </div>
            </section>

            {/* Operator runbook link */}
            <div className="text-xs" style={{ color: "#5A5A70" }}>
              Fix gaps via{" "}
              <a
                href="https://github.com/xrupert/staffd/blob/main/docs/operator-runbooks/pb-row-rules.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#A07BFF" }}
              >
                docs/operator-runbooks/pb-row-rules.md
              </a>
              {" "}— PB admin UI walkthrough per collection.
            </div>

            {/* Status table */}
            <section style={cardStyle}>
              <table className="w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={tableHeader}>Status</th>
                    <th style={tableHeader}>Collection</th>
                    <th style={tableHeader}>Gaps</th>
                    <th style={tableHeader}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {report.collections.map((c) => {
                    const isOpen = expanded.has(c.name);
                    return (
                      <>
                        <tr
                          key={c.name}
                          onClick={() => toggleExpand(c.name)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={tableCell}>
                            <span style={{ color: statusColor(c.status), fontSize: "16px" }}>{c.status}</span>
                          </td>
                          <td style={{ ...tableCell, fontFamily: "monospace", color: "#F0F0F8" }}>
                            {c.name}
                          </td>
                          <td style={tableCell}>
                            {c.gaps.length === 0 ? (
                              <span style={{ color: "#5A5A70" }}>—</span>
                            ) : (
                              <span style={{ color: statusColor(c.status) }}>
                                {c.gaps.length} {c.gaps.length === 1 ? "gap" : "gaps"} · click to expand
                              </span>
                            )}
                          </td>
                          <td style={{ ...tableCell, fontSize: "11px", color: "#7070A0" }}>
                            {c.note ?? ""}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${c.name}-expanded`}>
                            <td colSpan={4} style={{ ...tableCell, background: "#0D0D14" }}>
                              {c.gaps.length > 0 && (
                                <div className="mb-3">
                                  <p className="text-xs font-semibold mb-2" style={{ color: "#EF4444" }}>Gaps</p>
                                  <ul style={{ listStyle: "disc", paddingLeft: "20px", color: "#D0D0E8", fontSize: "12px" }}>
                                    {c.gaps.map((g, i) => <li key={i}>{g}</li>)}
                                  </ul>
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-3 mt-2">
                                <div>
                                  <p className="text-xs font-semibold mb-1" style={{ color: "#7070A0" }}>Expected</p>
                                  <pre className="text-xs" style={{ color: "#9090A8", background: "#09090F", padding: "8px", borderRadius: "6px", overflow: "auto" }}>
                                    {JSON.stringify(c.expected_rules, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold mb-1" style={{ color: "#7070A0" }}>Actual</p>
                                  <pre className="text-xs" style={{ color: "#9090A8", background: "#09090F", padding: "8px", borderRadius: "6px", overflow: "auto" }}>
                                    {c.actual_rules === null ? "(collection not found)" : JSON.stringify(c.actual_rules, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <p className="text-xs text-right" style={{ color: "#3A3A55" }}>
              {report.collections_checked} collections checked
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
