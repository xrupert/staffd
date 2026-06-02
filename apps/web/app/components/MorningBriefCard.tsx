"use client";

/**
 * MorningBriefCard — dashboard surface for Phase 6's nightly autonomous brief.
 *
 * Renders the user's latest `vault_briefs` row. Each section is a collapsible
 * card with the generated body + Approve / Dismiss / Open in dept actions.
 * Once every section is non-pending the brief collapses into a "reviewed"
 * pill so it doesn't dominate the dashboard.
 *
 * Empty state: when no brief exists yet we coach the user that one will be
 * generated tonight. We don't render the card at all if the user is
 * brand-new (no docs yet) — that gets handled upstream.
 */

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";

type BriefSectionStatus = "pending" | "approved" | "dismissed";
type BriefSectionKind = "synthesis" | "draft_post" | "review_reply" | "sales_followup" | "ops_summary";
type BriefSection = {
  id: string;
  department: string;
  kind: BriefSectionKind;
  title: string;
  body: string;
  status: BriefSectionStatus;
  meta?: { agentId?: string; model?: string };
};
type BriefRow = {
  id: string;
  user: string;
  date: string;
  sections: BriefSection[];
  status: "pending" | "reviewed" | "dismissed";
  generated_at?: string;
};

const DEPT_HREFS: Record<string, string> = {
  ceo: "/dashboard/ceo",
  marketing: "/dashboard/marketing",
  sales: "/dashboard/sales",
  legal: "/dashboard/legal",
  hr: "/dashboard/hr",
  finance: "/dashboard/finance",
  operations: "/dashboard/operations",
  "paid-media": "/dashboard/paid-media",
  design: "/dashboard/design",
  reputation: "/dashboard/reputation",
};

const DEPT_LABELS: Record<string, string> = {
  ceo: "The CEO",
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  "paid-media": "Paid Media",
  design: "Design",
  reputation: "Reputation",
};

const KIND_ICON: Record<BriefSectionKind, string> = {
  synthesis: "🧭",
  draft_post: "✍️",
  review_reply: "💬",
  sales_followup: "📞",
  ops_summary: "📅",
};

function isTodayOrTomorrow(date: string): boolean {
  if (!date) return false;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return date === today || date === tomorrow;
}

function humanDate(date: string): string {
  if (!date) return "";
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return new Date(date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function MorningBriefCard() {
  const [brief, setBrief] = useState<BriefRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) { setLoading(false); return; }
    void (async () => {
      try {
        const res = await fetch(`/api/vault/briefs?userId=${encodeURIComponent(userId)}`, {
          headers: { Authorization: token },
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; brief?: BriefRow | null };
          setBrief(data.brief ?? null);
          // Expand first pending section by default for momentum.
          if (data.brief?.sections) {
            const firstPending = data.brief.sections.find((s) => s.status === "pending");
            if (firstPending) setExpanded(new Set([firstPending.id]));
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function updateSection(sectionId: string, status: BriefSectionStatus) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token || !brief) return;
    setUpdatingId(sectionId);
    setError(null);
    try {
      const res = await fetch("/api/vault/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, sectionId, status, briefId: brief.id }),
      });
      const data = await res.json();
      if (data.ok && data.brief) {
        setBrief(data.brief as BriefRow);
      } else {
        setError(data.error ?? "update_failed");
      }
    } catch {
      setError("network_error");
    } finally {
      setUpdatingId(null);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return null; // silent while loading — don't flash an empty card

  // No brief yet — show the "your morning brief will be ready" affordance,
  // but only when there's something to coach about (the user has had time
  // for the cron to actually run). For now we skip rendering entirely when
  // absent to keep the dashboard clean.
  if (!brief) return null;

  // Old briefs: don't surface anything more than 2 days old.
  if (!isTodayOrTomorrow(brief.date)) {
    const isRecent = (() => {
      const briefDate = new Date(brief.date).getTime();
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      return briefDate >= twoDaysAgo;
    })();
    if (!isRecent) return null;
  }

  const pendingCount = brief.sections.filter((s) => s.status === "pending").length;
  const allHandled = pendingCount === 0;

  return (
    <section
      className="rounded-2xl overflow-hidden mb-8"
      style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.3)" }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid #1E1E2A" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
            style={{ background: "rgba(91,33,232,0.18)", border: "1px solid rgba(91,33,232,0.35)" }}
          >
            ☀️
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#A07BFF" }}>
              Morning Brief
            </p>
            <p className="text-sm font-bold" style={{ color: "#F0F0F8" }}>
              {humanDate(brief.date)}
              {brief.sections.length > 0 && (
                <span className="ml-2 font-normal text-xs" style={{ color: "#5A5A70" }}>
                  · {brief.sections.length} section{brief.sections.length === 1 ? "" : "s"} from your staff
                </span>
              )}
            </p>
          </div>
        </div>
        {allHandled ? (
          <span className="text-xs px-2 py-1 rounded-md" style={{ background: "rgba(34,197,94,0.10)", color: "#22C55E", border: "1px solid rgba(34,197,94,0.25)" }}>
            All reviewed
          </span>
        ) : (
          <span className="text-xs" style={{ color: "#5A5A70" }}>
            {pendingCount} pending
          </span>
        )}
      </div>

      {/* Sections */}
      <div className="px-5 py-4 flex flex-col gap-3">
        {brief.sections.map((s) => {
          const isExpanded = expanded.has(s.id);
          const isUpdating = updatingId === s.id;
          const isDismissed = s.status === "dismissed";
          const isApproved = s.status === "approved";

          return (
            <div
              key={s.id}
              className="rounded-xl overflow-hidden"
              style={{
                background: "#0D0D16",
                border: `1px solid ${isApproved ? "rgba(34,197,94,0.2)" : isDismissed ? "#1A1A24" : "#2A2A38"}`,
                opacity: isDismissed ? 0.55 : 1,
              }}
            >
              {/* Section header */}
              <button
                onClick={() => toggleExpand(s.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left transition-colors"
                style={{ background: "transparent" }}
              >
                <span style={{ fontSize: "16px" }}>{KIND_ICON[s.kind] ?? "•"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#7070A0" }}>
                      {DEPT_LABELS[s.department] ?? s.department}
                    </span>
                    {isApproved && (
                      <span className="text-xs" style={{ color: "#22C55E" }}>✓ approved</span>
                    )}
                    {isDismissed && (
                      <span className="text-xs" style={{ color: "#5A5A70" }}>dismissed</span>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-0.5" style={{ color: "#F0F0F8" }}>
                    {s.title}
                  </p>
                </div>
                <span className="text-xs" style={{ color: "#5A5A70" }}>
                  {isExpanded ? "▾" : "▸"}
                </span>
              </button>

              {/* Section body */}
              {isExpanded && (
                <div className="px-4 pb-4">
                  <div
                    className="agent-output text-sm rounded-lg px-4 py-3 mb-3"
                    style={{ background: "#09090F", border: "1px solid #1E1E2A", color: "#D0D0E8", lineHeight: 1.6 }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
                  </div>
                  {!isDismissed && !isApproved && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => void updateSection(s.id, "approved")}
                        disabled={isUpdating}
                        className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                        style={{ opacity: isUpdating ? 0.5 : 1 }}
                      >
                        {isUpdating ? "Saving…" : "Approve"}
                      </button>
                      <a
                        href={`${DEPT_HREFS[s.department] ?? "/dashboard"}?from_brief=${s.id}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", textDecoration: "none" }}
                      >
                        Open in {DEPT_LABELS[s.department] ?? s.department} →
                      </a>
                      <button
                        onClick={() => void updateSection(s.id, "dismissed")}
                        disabled={isUpdating}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ml-auto"
                        style={{ background: "transparent", color: "#5A5A70" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                  {(isApproved || isDismissed) && (
                    <button
                      onClick={() => void updateSection(s.id, "pending")}
                      disabled={isUpdating}
                      className="text-xs transition-colors hover:text-white"
                      style={{ color: "#5A5A70" }}
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="px-5 pb-3">
          <p className="text-xs" style={{ color: "#EF4444" }}>Couldn't update: {error}</p>
        </div>
      )}
    </section>
  );
}
