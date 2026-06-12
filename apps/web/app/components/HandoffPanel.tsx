"use client";

/**
 * HandoffPanel (Phase 9).
 *
 * Rendered inside a department room after a generation completes + the
 * document is saved. Calls `/api/handoff/suggest` (B5 endpoint) with the
 * source document id and renders 2–3 cross-functional next-step suggestions.
 *
 * Each suggestion is a one-click deep link into the target department, with
 * the suggested task carried via the `?prefill=` query param so the dest
 * room can hydrate its task input.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import ActionAffordances from "./ActionAffordances";
import type { ActionCandidate } from "../api/_lib/orchestrator/action-vocabulary";

type FollowUp = {
  department: string;
  task: string;
  rationale: string;
  locked?: boolean;
};

const DEPT_HREFS: Record<string, string> = {
  marketing: "/dashboard/marketing",
  sales: "/dashboard/sales",
  legal: "/dashboard/legal",
  hr: "/dashboard/hr",
  finance: "/dashboard/finance",
  operations: "/dashboard/operations",
  design: "/dashboard/design",
  "paid-media": "/dashboard/paid-media",
  reputation: "/dashboard/reputation",
  ceo: "/dashboard/ceo",
};

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  design: "Design",
  "paid-media": "Paid Media",
  reputation: "Reputation",
  ceo: "The CEO",
};

type Props = {
  documentId: string;
  sourceDepartment: string;
  /** Plain output text the prior generation produced — used as the handoff seed. */
  sourceText?: string;
  /** W64 — reports the raw action candidates upward so the host surface
   *  can apply D10′′ conditional dedup against its static buttons. */
  onCandidates?: (candidates: ActionCandidate[]) => void;
};

export default function HandoffPanel({ documentId, sourceDepartment, sourceText, onCandidates }: Props) {
  const [followUps, setFollowUps] = useState<FollowUp[] | null>(null);
  // W63 — the platform-action axis from the same response.
  const [actionCandidates, setActionCandidates] = useState<ActionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!documentId) { setLoading(false); return; }
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) { setLoading(false); return; }

    void (async () => {
      try {
        const res = await fetch("/api/handoff/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId,
            userId,
            pbToken: token,
            // include sourceDoc as a hint so the orchestrator can run even if
            // the doc fetch is slow on its end
            sourceDoc: { department: sourceDepartment, outputExcerpt: sourceText?.slice(0, 800) },
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setError("load_failed");
          return;
        }
        const data = await res.json();
        const items: FollowUp[] = data?.ok ? (data.followUps ?? []) : (data?.degraded?.followUps ?? []);
        setFollowUps(items);
        const candidates =
          (data?.ok ? data.actionCandidates : data?.degraded?.actionCandidates) ?? [];
        setActionCandidates(candidates);
        onCandidates?.(candidates);
      } catch {
        if (!cancelled) setError("network_error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [documentId, sourceDepartment, sourceText]);

  if (loading) {
    return (
      <div className="rounded-xl px-4 py-3" style={{ background: "#0D0D16", border: "1px solid #1E1E2A" }}>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Looking for cross-functional next steps…</p>
      </div>
    );
  }

  // W63 — the card renders if EITHER axis has content; silent only when
  // both are empty (candidates-only is a valid state when the FollowUp
  // parse degraded but the analyzer succeeded).
  const visibleCandidates = actionCandidates;
  if (error || ((!followUps || followUps.length === 0) && visibleCandidates.length === 0)) {
    return null; // silent — no value in showing an empty handoff card
  }

  return (
    <div
      className="rounded-xl px-4 py-3 mt-3"
      style={{ background: "rgba(91,33,232,0.04)", border: "1px solid rgba(91,33,232,0.2)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: "12px" }}>🔀</span>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#A07BFF" }}>
          Next steps your staff suggests
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {(followUps ?? []).slice(0, 3).map((f, i) => {
          const href = DEPT_HREFS[f.department] ?? "/dashboard";
          const label = DEPT_LABELS[f.department] ?? f.department;
          const fullHref = `${href}?prefill=${encodeURIComponent(f.task)}&from_doc=${encodeURIComponent(documentId)}`;
          return (
            <li key={i} className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <a
                  href={fullHref}
                  className="text-xs font-semibold transition-colors"
                  style={{ color: f.locked ? "#F59E0B" : "#D0D0E8", textDecoration: "none" }}
                >
                  {label} →{" "}
                  <span style={{ color: f.locked ? "#F59E0B" : "#A07BFF" }}>{f.task}</span>
                </a>
                {f.rationale && (
                  <p className="text-xs mt-0.5" style={{ color: "#5A5A70", lineHeight: 1.45 }}>
                    {f.rationale}
                  </p>
                )}
              </div>
              {f.locked && (
                <span
                  className="text-xs px-2 py-0.5 rounded-md flex-shrink-0 mt-0.5"
                  style={{ background: "rgba(245,158,11,0.10)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.25)" }}
                  title="This dept is locked on your current plan"
                >
                  Locked
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* W63 — the platform-action axis (W62 candidates) rendered beneath
          the cross-department FollowUps. Hidden actions never render;
          empty candidates render nothing. */}
      <ActionAffordances
        candidates={visibleCandidates}
        context={{ department: sourceDepartment, documentId }}
      />
    </div>
  );
}
