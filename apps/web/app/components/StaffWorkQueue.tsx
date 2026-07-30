"use client";

/**
 * StaffWorkQueue (wire-the-loop) — the dashboard surface that closes two cuts
 * in the ask → plan → approve → execute → think-ahead loop:
 *
 *  1. AWAITING YOUR REVIEW — workflows paused at `awaiting_review` (a drafted
 *     ticket reply / signature doc). Before this card existed the machine
 *     paused forever: the approve/cancel endpoints had zero UI callers, so
 *     the second (send) worker could never fire. The draft is editable; the
 *     approve endpoint accepts the edited text.
 *
 *  2. WHAT'S NEXT — after a planner workflow completes, the drain stamps up
 *     to 3 follow-on suggestions (`suggested_next`) on the workflow. Chips
 *     here feed the suggestion straight back into /api/workflow/plan →
 *     inline proposal → /api/workflow/commit. Same propose-then-ratify gate
 *     as everything else — a chip click never auto-executes.
 *
 * Reads workflows directly from PocketBase with the user's own session token
 * (USER_OWNED row rules — the NotificationBell pattern). Renders nothing when
 * there's nothing actionable.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type ReviewWorkflow = {
  id: string;
  recipe_id?: string;
  draft_output?: string;
  created: string;
};

type Suggestion = { title: string; goal: string };

type CompletedWorkflow = {
  id: string;
  goal?: string;
  suggested_next?: Suggestion[];
};

type PlanStep = { department: string; task: string };

const RECIPE_LABELS: Record<string, string> = {
  reply_to_ticket: "Support reply draft",
  send_for_signature: "Signature document draft",
};

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", design: "Design",
  "paid-media": "Paid Media", reputation: "Reputation", ceo: "The CEO",
};

export default function StaffWorkQueue() {
  const [reviews, setReviews] = useState<ReviewWorkflow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<CompletedWorkflow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ goal: string; steps: PlanStep[]; plan: unknown } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const uid = pb.authStore.record?.id ?? "";
    if (!uid) return;
    try {
      const res = await pb.collection("workflows").getList(1, 5, {
        filter: `user = '${uid}' && status = 'awaiting_review'`,
        sort: "-created",
      });
      const items = res.items as unknown as ReviewWorkflow[];
      setReviews(items);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const wf of items) if (next[wf.id] === undefined) next[wf.id] = wf.draft_output ?? "";
        return next;
      });
    } catch { /* row rules / offline — render nothing new */ }
    try {
      const res = await pb.collection("workflows").getList(1, 3, {
        filter: `user = '${uid}' && status = 'completed'`,
        sort: "-created",
      });
      const withNext = (res.items as unknown as CompletedWorkflow[]).find(
        (w) => Array.isArray(w.suggested_next) && w.suggested_next.length > 0,
      );
      setCompleted(withNext ?? null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  async function act(id: string, action: "approve" | "cancel") {
    if (busy) return;
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: action === "approve" ? JSON.stringify({ edited_draft: drafts[id] ?? "" }) : "{}",
      });
      if (res.ok) {
        setReviews((prev) => prev.filter((w) => w.id !== id));
        setNote(action === "approve" ? "Approved — sending now." : "Cancelled — nothing was sent.");
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(`Couldn't ${action}: ${data.error ?? `error_${res.status}`}`);
      }
    } catch {
      setNote(`Couldn't ${action} — check your connection and try again.`);
    } finally {
      setBusy(null);
    }
  }

  async function planSuggestion(s: Suggestion) {
    if (busy) return;
    setBusy("suggestion");
    setNote(null);
    try {
      const res = await fetch("/api/workflow/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ goal: s.goal }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; plan?: unknown; steps?: PlanStep[] };
      if (res.ok && data.ok && data.plan && data.steps?.length) {
        setProposal({ goal: s.goal, steps: data.steps, plan: data.plan });
      } else {
        setNote("Couldn't draft a plan for that just now — try again.");
      }
    } catch {
      setNote("Couldn't draft a plan for that just now — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function approveProposal() {
    if (!proposal || busy) return;
    setBusy("commit");
    try {
      const res = await fetch("/api/workflow/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ goal: proposal.goal, plan: proposal.plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; taskCount?: number };
      if (res.ok && data.ok) {
        setNote(`Queued — ${data.taskCount ?? proposal.steps.length} steps are underway. You'll get a notification when it's done.`);
        setProposal(null);
        setCompleted(null); // the chips did their job for this cycle
      } else {
        setNote("Couldn't queue the plan — try approving again.");
      }
    } catch {
      setNote("Couldn't queue the plan — try approving again.");
    } finally {
      setBusy(null);
    }
  }

  const suggestions = completed?.suggested_next ?? [];
  if (reviews.length === 0 && suggestions.length === 0 && !note) return null;

  return (
    <section className="rounded-2xl overflow-hidden mb-6" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
      <div className="px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: "1px solid #1E1E2A" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base" style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.35)" }}>
          📋
        </div>
        <div>
          <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>Staff work queue</p>
          <p className="text-xs" style={{ color: "#7A7A95" }}>Drafts waiting on you, and what your staff suggests next</p>
        </div>
      </div>

      {/* Awaiting review — the approve/edit/cancel gate before anything customer-facing sends */}
      {reviews.map((wf) => (
        <div key={wf.id} className="px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold" style={{ color: "#F59E0B" }}>Awaiting your review</span>
            <span className="text-xs" style={{ color: "#7A7A95" }}>{RECIPE_LABELS[wf.recipe_id ?? ""] ?? "Draft"}</span>
          </div>
          <textarea
            value={drafts[wf.id] ?? ""}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [wf.id]: e.target.value }))}
            rows={5}
            className="w-full text-xs px-3 py-2.5 rounded-xl outline-none mb-3"
            style={{ background: "#0D0D16", border: "1px solid #2A2A38", color: "#D0D0E8", lineHeight: 1.6, resize: "vertical" }}
          />
          <div className="flex items-center gap-4">
            <button
              onClick={() => void act(wf.id, "approve")}
              disabled={busy !== null}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white btn-primary"
              style={{ opacity: busy === wf.id ? 0.6 : 1 }}
            >
              {busy === wf.id ? "Sending…" : "Approve & send"}
            </button>
            <button
              onClick={() => void act(wf.id, "cancel")}
              disabled={busy !== null}
              className="text-xs transition-colors hover:text-red-400"
              style={{ color: "#7A7A95", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel — don't send
            </button>
          </div>
        </div>
      ))}

      {/* What's next — follow-on suggestions from the last completed plan */}
      {suggestions.length > 0 && !proposal && (
        <div className="px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#7070A0" }}>
            What's next
          </p>
          {completed?.goal && (
            <p className="text-xs mb-2.5" style={{ color: "#7A7A95" }}>
              After finishing “{completed.goal.length > 80 ? completed.goal.slice(0, 80) + "…" : completed.goal}”, your staff suggests:
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => void planSuggestion(s)}
                disabled={busy !== null}
                title={s.goal}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:text-white"
                style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.30)", color: "#A07BFF", cursor: "pointer" }}
              >
                {busy === "suggestion" ? "Planning…" : s.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inline proposal for a clicked suggestion — same ratify gate as CommandCenter */}
      {proposal && (
        <div className="px-5 py-4">
          <p className="text-xs font-semibold mb-2" style={{ color: "#F0F0F8" }}>
            Proposed plan — {proposal.steps.length} steps, runs in order
          </p>
          <div className="flex flex-col gap-2 mb-3">
            {proposal.steps.map((s, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-xs font-bold w-5 flex-shrink-0 text-right" style={{ color: "#5B21E8" }}>{i + 1}.</span>
                <div className="min-w-0">
                  <span className="text-xs font-semibold" style={{ color: "#A07BFF" }}>{DEPT_LABELS[s.department] ?? s.department}</span>
                  <p className="text-xs" style={{ color: "#D0D0E8", lineHeight: 1.6 }}>{s.task}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => void approveProposal()}
              disabled={busy !== null}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white btn-primary"
              style={{ opacity: busy === "commit" ? 0.6 : 1 }}
            >
              {busy === "commit" ? "Queuing…" : "Approve & run plan"}
            </button>
            <button
              onClick={() => setProposal(null)}
              disabled={busy !== null}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#7A7A95", background: "none", border: "none", cursor: "pointer" }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {note && (
        <div className="px-5 py-3">
          <p className="text-xs" style={{ color: note.startsWith("Couldn't") ? "#EF4444" : "#22C55E" }}>{note}</p>
        </div>
      )}
    </section>
  );
}
