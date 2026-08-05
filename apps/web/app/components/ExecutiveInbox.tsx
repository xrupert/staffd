"use client";

import { useState, type ReactNode } from "react";
import pb from "../../lib/pb";

export type ExecutiveInboxItem = {
  id: string;
  source?: string;
  sourceId?: string;
  kind: string;
  priority: "critical" | "high" | "normal";
  title: string;
  summary: string;
  evidence?: string[];
  actionLabel: string;
  actionHref: string;
};

type ResearchReviewRecord = {
  id: string;
  topic: string;
  claim: string;
  answer?: { confidence?: string; reason?: string };
  citations?: Array<{ id?: string; title?: string; url?: string; relationship?: string }>;
};

const PRIORITY_LABEL: Record<ExecutiveInboxItem["priority"], string> = {
  critical: "Needs you now",
  high: "Important",
  normal: "Upcoming",
};

const PRIORITY_COLOR: Record<ExecutiveInboxItem["priority"], string> = {
  critical: "#E78A8A",
  high: "#D6A85F",
  normal: "#A98CFF",
};

export function buildInboxActionPrompt(item: ExecutiveInboxItem): string {
  const evidence = (item.evidence ?? []).filter(Boolean);
  const context = evidence.length > 0 ? ` Evidence: ${evidence.join("; ")}.` : "";
  return `${item.actionLabel}. ${item.title}: ${item.summary}.${context} Review the situation, propose the best next action, and do not send or publish anything without my approval.`;
}

export function isResearchReviewItem(item: ExecutiveInboxItem): boolean {
  return item.source === "research" && item.kind === "approval" && Boolean(item.sourceId);
}

function authHeaders(): Record<string, string> {
  const token = pb.authStore.token;
  return token ? { Authorization: token, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function prefillCommandCenter(prompt: string): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) return false;

  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(textarea, prompt);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
  textarea.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

function InboxShell({ children }: { children: ReactNode }) {
  return (
    <section
      aria-labelledby="executive-inbox-heading"
      className="mb-4 rounded-xl px-4 py-3"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid #252534" }}
    >
      {children}
    </section>
  );
}

export default function ExecutiveInbox({
  items,
  onAction,
}: {
  items: ExecutiveInboxItem[];
  onAction?: (prompt: string) => void;
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [researchById, setResearchById] = useState<Record<string, ResearchReviewRecord>>({});
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleItems = items.filter((item) => !hiddenIds.has(item.id)).slice(0, 3);
  if (visibleItems.length === 0) return null;

  function handleAction(item: ExecutiveInboxItem) {
    const prompt = buildInboxActionPrompt(item);
    if (onAction) {
      onAction(prompt);
      return;
    }
    if (!prefillCommandCenter(prompt)) window.location.href = item.actionHref;
  }

  async function openResearchReview(item: ExecutiveInboxItem) {
    if (!item.sourceId) return;
    setError(null);
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (researchById[item.sourceId]) return;
    setWorkingId(item.id);
    try {
      const response = await fetch("/api/research/records", { headers: authHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load the research evidence.");
      const payload = (await response.json()) as { items?: ResearchReviewRecord[] };
      const record = (payload.items ?? []).find((entry) => entry.id === item.sourceId);
      if (!record) throw new Error("This research decision is no longer pending.");
      setResearchById((current) => ({ ...current, [record.id]: record }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the research evidence.");
    } finally {
      setWorkingId(null);
    }
  }

  async function decideResearch(item: ExecutiveInboxItem, decision: "approved" | "rejected") {
    if (!item.sourceId) return;
    setWorkingId(item.id);
    setError(null);
    try {
      const response = await fetch("/api/research/records", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ id: item.sourceId, decision }),
      });
      if (!response.ok) throw new Error("STAFFD could not save your decision.");
      setHiddenIds((current) => new Set(current).add(item.id));
      setExpandedId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "STAFFD could not save your decision.");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <InboxShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id="executive-inbox-heading" className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>
            What needs your attention
          </p>
          <p className="mt-1 text-xs" style={{ color: "#72728A" }}>
            STAFFD combined approvals, repairs, completed work, and upcoming conversations into one queue.
          </p>
        </div>
        <span className="text-xs font-semibold" style={{ color: "#A98CFF" }}>
          {items.length - hiddenIds.size} open
        </span>
      </div>

      {error && <p className="mt-3 text-xs" role="alert" style={{ color: "#E78A8A" }}>{error}</p>}

      <div className="mt-3 space-y-2">
        {visibleItems.map((item) => {
          const research = item.sourceId ? researchById[item.sourceId] : undefined;
          const expanded = expandedId === item.id;
          return (
            <article
              key={item.id}
              className="rounded-lg px-3 py-3"
              style={{ background: "#12121A", border: "1px solid #252534" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: PRIORITY_COLOR[item.priority] }}>
                    {PRIORITY_LABEL[item.priority]}
                  </p>
                  <h3 className="mt-1 text-xs font-semibold" style={{ color: "#D8D8E8" }}>
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "#7A7A95" }}>
                    {item.summary}
                  </p>
                  {item.evidence?.[0] && (
                    <p className="mt-2 text-[11px]" style={{ color: "#606078" }}>
                      Why: {item.evidence[0]}
                    </p>
                  )}
                </div>
                {isResearchReviewItem(item) ? (
                  <button
                    type="button"
                    onClick={() => void openResearchReview(item)}
                    disabled={workingId === item.id}
                    className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    style={{ background: "rgba(91,33,232,0.16)", color: "#C4B5FD", border: "1px solid rgba(91,33,232,0.3)" }}
                  >
                    {workingId === item.id ? "Loading…" : expanded ? "Hide evidence" : item.actionLabel}
                  </button>
                ) : item.kind === "incoming" ? (
                  <button
                    type="button"
                    onClick={() => handleAction(item)}
                    className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{ background: "rgba(91,33,232,0.16)", color: "#C4B5FD", border: "1px solid rgba(91,33,232,0.3)" }}
                  >
                    {item.actionLabel}
                  </button>
                ) : (
                  <a
                    href={item.actionHref}
                    className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{ background: "rgba(91,33,232,0.16)", color: "#C4B5FD", border: "1px solid rgba(91,33,232,0.3)" }}
                  >
                    {item.actionLabel}
                  </a>
                )}
              </div>

              {expanded && research && (
                <div className="mt-3 rounded-lg p-3" style={{ background: "#0D0D14", border: "1px solid #252534" }}>
                  <p className="text-xs font-semibold" style={{ color: "#E8E8F2" }}>{research.claim}</p>
                  {research.answer?.reason && <p className="mt-2 text-xs leading-relaxed" style={{ color: "#8888A0" }}>{research.answer.reason}</p>}
                  <div className="mt-3 space-y-2">
                    {(research.citations ?? []).map((citation) => (
                      <a
                        key={citation.id ?? citation.url}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-xs underline underline-offset-2"
                        style={{ color: "#A98CFF" }}
                      >
                        {citation.title ?? citation.url} {citation.relationship ? `— ${citation.relationship}` : ""}
                      </a>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void decideResearch(item, "approved")}
                      disabled={workingId === item.id}
                      className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      style={{ background: "rgba(70,170,120,0.16)", color: "#9FE0B8", border: "1px solid rgba(70,170,120,0.3)" }}
                    >
                      Approve as business knowledge
                    </button>
                    <button
                      type="button"
                      onClick={() => void decideResearch(item, "rejected")}
                      disabled={workingId === item.id}
                      className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      style={{ background: "rgba(190,80,80,0.12)", color: "#E8A0A0", border: "1px solid rgba(190,80,80,0.28)" }}
                    >
                      Reject this conclusion
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </InboxShell>
  );
}
