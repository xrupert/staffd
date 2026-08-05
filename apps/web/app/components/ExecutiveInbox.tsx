"use client";

import type { ReactNode } from "react";

export type ExecutiveInboxItem = {
  id: string;
  kind: string;
  priority: "critical" | "high" | "normal";
  title: string;
  summary: string;
  evidence?: string[];
  actionLabel: string;
  actionHref: string;
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
  if (items.length === 0) return null;

  const visibleItems = items.slice(0, 3);

  function handleAction(item: ExecutiveInboxItem) {
    const prompt = buildInboxActionPrompt(item);
    if (onAction) {
      onAction(prompt);
      return;
    }
    if (!prefillCommandCenter(prompt)) window.location.href = item.actionHref;
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
          {items.length} open
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {visibleItems.map((item) => (
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
              {item.kind === "incoming" ? (
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
          </article>
        ))}
      </div>
    </InboxShell>
  );
}
