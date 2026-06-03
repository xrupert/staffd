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

// Decision 71 — Orphan Investigation Panel.
type OrphanRecommendation =
  | "drop_safe"
  | "drop_after_migration"
  | "investigate_active_usage"
  | "keep_with_setup_route";

type OrphanDetail = {
  name: string;
  exists: boolean;
  collection_id?: string;
  collection_type?: string;
  field_count?: number;
  fields?: Array<{ name: string; type: string; required: boolean }>;
  row_count?: number;
  last_modified?: string;
  created_at?: string;
  current_rules?: RuleSet;
  canonical_equivalent: string | null;
  canonical_field_count?: number;
  schema_overlap_with_canonical?: number;
  recommendation: OrphanRecommendation;
  recommendation_reason: string;
};

type OrphanReport = {
  timestamp: string;
  collections: OrphanDetail[];
  note: string;
};

type RecordedDecision = {
  id: string;
  collection_name: string;
  decision: OrphanRecommendation;
  reason?: string;
  decided_by: string;
  status: string;
  created: string;
};

const DECISION_LABELS: Record<OrphanRecommendation, string> = {
  drop_safe: "Mark Drop-Safe",
  drop_after_migration: "Mark Drop-After-Migration",
  investigate_active_usage: "Mark for Investigation",
  keep_with_setup_route: "Mark Keep + Add Setup Route",
};

const DECISION_DESCRIPTIONS: Record<OrphanRecommendation, string> = {
  drop_safe: "Empty + canonical exists. Senior Architect can approve drop.",
  drop_after_migration: "Has rows; canonical exists. Requires data migration first.",
  investigate_active_usage: "Unclear. Investigate code references before any action.",
  keep_with_setup_route: "Active collection that should be in the baseline.",
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
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  // Decision 71 — Orphan Investigation Panel state
  const [orphanReport, setOrphanReport] = useState<OrphanReport | null>(null);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [orphanError, setOrphanError] = useState<string | null>(null);
  const [recordedDecisions, setRecordedDecisions] = useState<RecordedDecision[]>([]);
  const [orphanReasons, setOrphanReasons] = useState<Record<string, string>>({});
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);

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

  // Decision 71 — load orphan investigation data + recorded decisions
  const loadOrphans = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setOrphanLoading(true);
    setOrphanError(null);
    try {
      const token = pb.authStore.token;
      const [detailsRes, decisionsRes] = await Promise.all([
        fetch(`/api/admin/orphan-details?pbToken=${encodeURIComponent(token)}`),
        fetch(`/api/admin/orphan-decisions?pbToken=${encodeURIComponent(token)}`),
      ]);
      if (!detailsRes.ok) {
        const data = await detailsRes.json().catch(() => ({}));
        setOrphanError(data.error ?? `error_${detailsRes.status}`);
      } else {
        const data = (await detailsRes.json()) as OrphanReport;
        setOrphanReport(data);
      }
      if (decisionsRes.ok) {
        const data = (await decisionsRes.json()) as { decisions: RecordedDecision[] };
        setRecordedDecisions(data.decisions ?? []);
      }
    } catch {
      setOrphanError("network_error");
    } finally {
      setOrphanLoading(false);
    }
  }, []);

  // Auto-load orphans whenever the main report includes ℹ️ entries
  useEffect(() => {
    if (!report) return;
    const hasOrphans = report.collections.some((c) => c.status === "ℹ️");
    if (hasOrphans && !orphanReport && !orphanLoading) {
      void loadOrphans();
    }
  }, [report, orphanReport, orphanLoading, loadOrphans]);

  async function recordDecision(collectionName: string, decision: OrphanRecommendation) {
    if (decisionPending) return;
    setDecisionPending(`${collectionName}:${decision}`);
    setDecisionMessage(null);
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/admin/orphan-decisions?pbToken=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection_name: collectionName,
          decision,
          reason: orphanReasons[collectionName] ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "collection_not_created") {
          setDecisionMessage(
            "orphan_decisions collection not yet created. Run POST /api/setup/orphan-decisions first.",
          );
        } else {
          setDecisionMessage(`Failed: ${data.error ?? `error_${res.status}`}`);
        }
      } else {
        setDecisionMessage(`Recorded: ${collectionName} → ${decision}`);
        await loadOrphans(); // refresh decisions list
      }
    } catch {
      setDecisionMessage("Failed: network error");
    } finally {
      setDecisionPending(null);
    }
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Decision 69 — single-click repair. Calls the bulk-repair endpoint then
  // re-fetches the status table. ~30-60 sec depending on collection count.
  async function runRepair() {
    if (repairing) return;
    setRepairing(true);
    setRepairMessage(null);
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/admin/repair-row-rules?pbToken=${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setRepairMessage(`Repair failed: ${data.error ?? `error_${res.status}`}`);
      } else {
        setRepairMessage(
          `${data.overall_status} — ${data.total_repaired} repaired · ` +
          `${data.total_already_correct} already correct · ` +
          `${data.total_skipped} skipped (system-managed) · ` +
          `${data.total_failed} failed`,
        );
      }
    } catch {
      setRepairMessage("Repair failed: network error");
    } finally {
      setRepairing(false);
      await load(); // refresh status after repair
    }
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
          <div className="flex items-center gap-2">
            {report && report.overall_status === "🔴" && (
              <button
                onClick={() => void runRepair()}
                disabled={repairing || loading}
                className="text-xs font-semibold px-3 py-2 rounded-lg"
                style={{
                  background: "#5B21E8",
                  color: "#fff",
                  border: "1px solid #5B21E8",
                  opacity: repairing || loading ? 0.5 : 1,
                }}
                title="Bulk-PATCH all collections to the expected row-rule pattern. Idempotent."
              >
                {repairing ? "Repairing…" : "Run Security Repair"}
              </button>
            )}
            <button
              onClick={() => void load()}
              disabled={loading || repairing}
              className="text-xs font-medium px-3 py-2 rounded-lg"
              style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: loading || repairing ? 0.5 : 1 }}
            >
              {loading ? "Refreshing…" : "Refresh Status"}
            </button>
          </div>
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

            {/* Repair result message (transient) */}
            {repairMessage && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: repairMessage.includes("failed") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
                  border: `1px solid ${repairMessage.includes("failed") ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)"}`,
                  color: repairMessage.includes("failed") ? "#EF4444" : "#22C55E",
                }}
              >
                {repairMessage}
              </div>
            )}

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

            {/* Decision 71 — Orphan Investigation Panel */}
            {report.collections.some((c) => c.status === "ℹ️") && (
              <section style={cardStyle}>
                <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#A07BFF" }}>
                      Unexpected Collections — Investigation Panel
                    </p>
                    <p className="text-xs" style={{ color: "#7070A0" }}>
                      Collections found in PB but not in the expected baseline. Record a decision per collection;
                      Senior Architect authorizes any drop via follow-up PR. No autonomous deletions.
                    </p>
                  </div>
                  <button
                    onClick={() => void loadOrphans()}
                    disabled={orphanLoading}
                    className="text-xs font-medium px-3 py-2 rounded-lg"
                    style={{
                      background: "#1A1A24",
                      border: "1px solid #2A2A38",
                      color: "#D0D0E8",
                      opacity: orphanLoading ? 0.5 : 1,
                    }}
                  >
                    {orphanLoading ? "Loading…" : "Refresh Investigation"}
                  </button>
                </div>

                {orphanError && (
                  <div
                    className="rounded-xl px-4 py-3 text-sm mb-4"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.25)",
                      color: "#EF4444",
                    }}
                  >
                    Could not load investigation data: {orphanError}
                  </div>
                )}

                {decisionMessage && (
                  <div
                    className="rounded-xl px-4 py-3 text-sm mb-4"
                    style={{
                      background: decisionMessage.startsWith("Failed") ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
                      border: `1px solid ${decisionMessage.startsWith("Failed") ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)"}`,
                      color: decisionMessage.startsWith("Failed") ? "#EF4444" : "#22C55E",
                    }}
                  >
                    {decisionMessage}
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  {orphanReport?.collections.map((o) => {
                    const existing = recordedDecisions.find((d) => d.collection_name === o.name);
                    return (
                      <div
                        key={o.name}
                        className="rounded-xl p-4"
                        style={{
                          background: "#09090F",
                          border: "1px solid #2A2A38",
                        }}
                      >
                        <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
                          <div>
                            <p style={{ fontFamily: "monospace", fontSize: "14px", color: "#F0F0F8", fontWeight: 600 }}>
                              {o.name}
                            </p>
                            <p className="text-xs mt-1" style={{ color: "#7070A0" }}>
                              {o.exists
                                ? `${o.row_count ?? 0} row(s) · ${o.field_count ?? 0} field(s)${o.last_modified ? ` · last modified ${new Date(o.last_modified).toLocaleString()}` : ""}`
                                : "Does not exist in PB"}
                            </p>
                          </div>
                          {existing && (
                            <span
                              className="text-xs px-2 py-1 rounded"
                              style={{
                                background: "rgba(160,123,255,0.10)",
                                color: "#A07BFF",
                                border: "1px solid rgba(160,123,255,0.25)",
                              }}
                            >
                              Recorded: {existing.decision} · {existing.status}
                            </span>
                          )}
                        </div>

                        {o.canonical_equivalent && (
                          <p className="text-xs mb-2" style={{ color: "#9090A8" }}>
                            Canonical equivalent: <code style={{ color: "#A07BFF" }}>{o.canonical_equivalent}</code>
                            {typeof o.schema_overlap_with_canonical === "number" &&
                              ` · ${Math.round(o.schema_overlap_with_canonical * 100)}% field overlap`}
                          </p>
                        )}

                        <div
                          className="text-xs p-3 rounded mb-3"
                          style={{
                            background: "rgba(91,33,232,0.08)",
                            border: "1px solid rgba(91,33,232,0.25)",
                            color: "#D0D0E8",
                          }}
                        >
                          <span style={{ color: "#A07BFF", fontWeight: 600 }}>
                            Recommendation: {o.recommendation}
                          </span>
                          <p className="mt-1" style={{ color: "#9090A8" }}>{o.recommendation_reason}</p>
                        </div>

                        {o.fields && o.fields.length > 0 && (
                          <details className="mb-3">
                            <summary className="text-xs cursor-pointer" style={{ color: "#7070A0" }}>
                              View schema ({o.fields.length} fields)
                            </summary>
                            <pre className="text-xs mt-2 p-2 rounded" style={{ background: "#0D0D14", color: "#9090A8", overflow: "auto" }}>
                              {o.fields.map((f) => `  ${f.name}: ${f.type}${f.required ? " (required)" : ""}`).join("\n")}
                            </pre>
                          </details>
                        )}

                        <input
                          type="text"
                          placeholder="Optional reason / notes…"
                          value={orphanReasons[o.name] ?? ""}
                          onChange={(e) =>
                            setOrphanReasons((prev) => ({ ...prev, [o.name]: e.target.value }))
                          }
                          className="w-full text-xs px-3 py-2 rounded mb-2"
                          style={{
                            background: "#1A1A24",
                            border: "1px solid #2A2A38",
                            color: "#D0D0E8",
                          }}
                        />

                        <div className="flex flex-wrap gap-2">
                          {(Object.keys(DECISION_LABELS) as OrphanRecommendation[]).map((d) => {
                            const isRecommended = d === o.recommendation;
                            const isPending = decisionPending === `${o.name}:${d}`;
                            return (
                              <button
                                key={d}
                                onClick={() => void recordDecision(o.name, d)}
                                disabled={!!decisionPending}
                                title={DECISION_DESCRIPTIONS[d]}
                                className="text-xs font-medium px-3 py-2 rounded"
                                style={{
                                  background: isRecommended ? "#5B21E8" : "#1A1A24",
                                  color: isRecommended ? "#fff" : "#D0D0E8",
                                  border: `1px solid ${isRecommended ? "#5B21E8" : "#2A2A38"}`,
                                  opacity: decisionPending ? 0.5 : 1,
                                }}
                              >
                                {isPending ? "Recording…" : DECISION_LABELS[d]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {orphanReport && orphanReport.collections.length === 0 && (
                    <p className="text-xs" style={{ color: "#7070A0" }}>
                      No unexpected collections detected.
                    </p>
                  )}
                </div>

                {orphanReport && (
                  <p className="text-xs mt-4" style={{ color: "#3A3A55" }}>
                    {orphanReport.note}
                  </p>
                )}
              </section>
            )}

            <p className="text-xs text-right" style={{ color: "#3A3A55" }}>
              {report.collections_checked} collections checked
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
