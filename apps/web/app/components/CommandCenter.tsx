"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";
import ThreadPickerDrawer, { type HydratedMessage } from "./ThreadPickerDrawer";
import CommandCenterSuggestions from "./CommandCenterSuggestions";
import ActionAffordances from "./ActionAffordances";
import type { ActionCandidate } from "../api/_lib/orchestrator/action-vocabulary";

interface Message {
  role: "user" | "assistant";
  content: string;
  isOutput?: boolean;
  lockedAlternative?: string;
}

interface PendingAction {
  department: string;
  agentId?: string;
  task: string;
  lockedAlternative?: string;
}

// PR-Tranche-2.6 (W28) — handoff intent response shape (subset; matches
// FollowUp in apps/web/app/api/_lib/orchestrator/types.ts).
interface HandoffSuggestion {
  department: string;
  task: string;
  rationale?: string;
  locked?: boolean;
}

type Phase = "idle" | "routing" | "confirmed" | "generating" | "done";

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", design: "Design",
  "paid-media": "Paid Media", reputation: "Reputation", ceo: "The CEO",
};

const DEPT_HREFS: Record<string, string> = {
  marketing: "/dashboard/marketing", sales: "/dashboard/sales",
  legal: "/dashboard/legal", hr: "/dashboard/hr",
  finance: "/dashboard/finance", operations: "/dashboard/operations",
  design: "/dashboard/design", "paid-media": "/dashboard/paid-media",
  reputation: "/dashboard/reputation", ceo: "/dashboard/ceo",
};

const THREAD_STORAGE_KEY = "staffd_command_center_thread_id_v1";

/**
 * PR-Tranche-2.5 (W26 fix) — strip orchestrator-protocol markers from
 * assistant messages before sending the conversation back to the
 * orchestrator on follow-up turns. The `READY:{...}` and `EXECUTE:{...}`
 * lines are UI-side protocol; the orchestrator should see clean
 * conversation context only. Exported for tests.
 */
export function cleanForOrchestrator(content: string): string {
  if (!content) return "";
  return content
    .replace(/\nREADY:\{.+?\}/gs, "")
    .replace(/READY:\{.+?\}/gs, "")
    .replace(/^EXECUTE:\{.+?\}\s*$/gs, "")
    .trim();
}

/**
 * PR-Tranche-2.6.5 (W38 + W39) — detect whether an agent's response ends
 * in a clarifying question (vs. a completed deliverable).
 *
 * Used to:
 *   - W38: skip the handoff intent fetch when the agent is waiting on the
 *     user (handoff suggestions are nonsense if the work isn't done yet)
 *   - W39: switch the input placeholder to "Type your reply…" and
 *     auto-focus the textarea so the user can answer immediately
 *
 * Predicate (intentionally simple, no over-engineering):
 *   - Trailing `?` after trim → question
 *   - Common interrogative phrasings in the last 200 chars → question
 *
 * The 200-char window catches "Which platform are you targeting?" near
 * the end of a multi-paragraph response without false-positiving on
 * questions inside the body (rhetorical questions, etc.).
 */
export function isAgentAskingQuestion(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  const tail = trimmed.slice(-200);
  const phrasings = /\b(which|what|how|would you|can you|should (we|i|you)|do you|are you|did you|where|when|why|tell me|let me know|share with me)\b/i;
  return phrasings.test(tail);
}

function loadOrCreateThreadId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(THREAD_STORAGE_KEY);
    if (existing) return existing;
    const fresh = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    window.localStorage.setItem(THREAD_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function CommandCenter() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [outputBuffer, setOutputBuffer] = useState("");
  const [lastLockedAlt, setLastLockedAlt] = useState<string | null>(null);
  // Phase 9 — persistent conversation thread. Survives reloads via localStorage
  // so /api/agent + /api/orchestrate can stitch turns together server-side.
  const [threadId, setThreadId] = useState<string>("");
  // Phase 25 — thread picker drawer.
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  // PR-Tranche-2.6 (W28) — cross-functional handoff suggestions surfaced
  // below the generated output. Fetched fire-and-forget after each
  // generation completes; non-blocking on failure.
  const [followUps, setFollowUps] = useState<HandoffSuggestion[]>([]);
  // W63 — the platform-action axis from the same handoff response.
  const [actionCandidates, setActionCandidates] = useState<ActionCandidate[]>([]);
  // Holds the last completed user task + department for downstream handoff
  // requests (the prior task is what `/api/handoff/suggest` uses as
  // sourceDoc.prompt).
  const [lastCompleted, setLastCompleted] = useState<{
    department: string;
    task: string;
    output: string;
    userGoal: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setThreadId(loadOrCreateThreadId());
  }, []);

  // PR-Tranche-2.6.5 (W39) — derived state: is the agent's most recent
  // assistant message a clarifying question? Drives placeholder switch +
  // auto-focus below. `useMemo` would be overkill — the messages array
  // doesn't churn fast enough to matter.
  const lastAgentMessage = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.content) return cleanContent(m.content);
    }
    return "";
  })();
  const agentAwaitingReply = phase === "done" && isAgentAskingQuestion(lastAgentMessage);

  // PR-Tranche-2.6.5 (W39) — auto-focus the textarea when the agent finishes
  // by asking a question. Reduces friction: user doesn't have to click into
  // the input to answer.
  useEffect(() => {
    if (agentAwaitingReply) {
      inputRef.current?.focus();
    }
  }, [agentAwaitingReply]);

  // Phase 25 — switch to an existing thread (hydrates message history).
  function switchToThread(newThreadId: string, hydrated: HydratedMessage[]) {
    setThreadId(newThreadId);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(THREAD_STORAGE_KEY, newThreadId); } catch { /* silent */ }
    }
    setMessages(hydrated.map((m) => ({ role: m.role, content: m.content })));
    setPendingAction(null);
    setOutputBuffer("");
    setLastLockedAlt(null);
    setPhase("idle");
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const CONFIRM_WORDS = /^(yes|confirm|confirmed|approved|approve|go|do it|go ahead|sure|yep|yup|ok|okay|sounds good|make it|run it|let'?s go)/i;

  /**
   * PR-Tranche-2.6.4 (W35) — `send()` options.
   * `skipConfirm` + `preselectDept` together short-circuit the orchestrate
   * round-trip AND the Yes/Cancel confirm gate. Used by Next Steps button
   * clicks where the followUp already knows the target department, so the
   * user's click IS explicit consent — no second-step confirm needed.
   * `preselectAgent` is optional (handoff intent doesn't currently emit
   * agentId; runAgent's existing smart-keyword picker fills in).
   */
  type SendOptions = {
    skipConfirm?: boolean;
    preselectDept?: string;
    preselectAgent?: string;
  };

  async function send(text?: string, options?: SendOptions) {
    const content = (text ?? input).trim();
    if (!content || phase === "routing" || phase === "generating") return;

    // PR-Tranche-2.5 (W26 fix) — auto-transition done → idle so the input
    // stays alive for follow-ups. Was previously trapped at "done" until
    // the user clicked the destructive "+ New request" reset.
    if (phase === "done") setPhase("idle");

    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    setPhase("routing");
    setTimeout(scrollToBottom, 50);

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    // PR-Tranche-2.6.4 (W35) — direct-execute path. Bypasses orchestrate
    // round-trip AND confirm gate when caller already knows the target
    // dept (Next Steps button click). User's click IS the explicit consent.
    if (options?.skipConfirm && options?.preselectDept) {
      setPhase("generating");
      await runAgent(options.preselectDept, content, userId, pbToken, options.preselectAgent);
      return;
    }

    // Check if this is a confirmation message with a pending action
    if (pendingAction && CONFIRM_WORDS.test(content)) {
      // User confirmed — execute
      setPhase("generating");
      const confirmMessages: Message[] = [
        ...newMessages,
        { role: "assistant", content: `EXECUTE:${JSON.stringify(pendingAction)}` },
      ];
      setMessages(confirmMessages);
      // Remember the locked alternative to surface as nudge after generation
      setLastLockedAlt(pendingAction.lockedAlternative?.trim() ? pendingAction.lockedAlternative : null);
      // Hotfix A2 — pass the orchestrator-picked agentId so the right
      // specialist runs (not the dept's first-in-list default).
      await runAgent(pendingAction.department, pendingAction.task, userId, pbToken, pendingAction.agentId);
      return;
    }

    // Route through orchestrator
    try {
      // PR-Tranche-2.5 (W26 fix) — strip UI-side protocol markers from
      // assistant messages before sending. Drop assistant messages that
      // become empty after cleaning (READY-only stubs). Keep user messages
      // as-is. Drop final empty placeholders.
      const cleanedMessages = newMessages
        .map((m) => ({
          role: m.role,
          content: m.role === "assistant" ? cleanForOrchestrator(m.content) : m.content,
        }))
        .filter((m) => m.content.length > 0);
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: cleanedMessages,
          userId,
          pbToken,
        }),
      });
      if (!res.ok) throw new Error("Orchestrate failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");

      let assistantText = "";
      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantText };
          return updated;
        });
        scrollToBottom();
      }

      // Check if response contains a READY action proposal
      const readyMatch = assistantText.match(/READY:(\{.+?\})/s);
      if (readyMatch?.[1]) {
        try {
          const action = JSON.parse(readyMatch[1]) as PendingAction;
          setPendingAction(action);
          setPhase("idle");
        } catch {
          setPhase("idle");
        }
      } else {
        setPendingAction(null);
        setPhase("idle");
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Try again." },
      ]);
      setPhase("idle");
    }

    setTimeout(scrollToBottom, 100);
  }

  // PR-Tranche-2.6 (W28) — fire the handoff intent after a successful
  // generation; render returned followUps as buttons below the output.
  // Non-blocking: failures are logged but never surface a UI error
  // (handoff is a polish feature, not a critical path).
  async function fetchHandoffSuggestions(
    department: string,
    task: string,
    output: string,
    userGoal: string,
    userId: string,
    pbToken: string,
    documentIdPromise?: Promise<string | undefined>,
  ): Promise<void> {
    try {
      const res = await fetch("/api/handoff/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          pbToken,
          documentId: await documentIdPromise?.catch(() => undefined),
          sourceDoc: {
            department,
            prompt: task,
            outputExcerpt: output.length > 1200 ? output.slice(0, 1200) + "…" : output,
          },
          query: userGoal,
        }),
      });
      if (!res.ok) {
        console.warn("[CommandCenter] handoff fetch failed", { status: res.status });
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        followUps?: HandoffSuggestion[];
        actionCandidates?: ActionCandidate[];
        degraded?: { followUps?: HandoffSuggestion[]; actionCandidates?: ActionCandidate[] };
      };
      const suggestions = data.followUps ?? data.degraded?.followUps ?? [];
      setFollowUps(suggestions.slice(0, 3));
      // W63 — the platform-action axis arrives in the same response.
      setActionCandidates(data.actionCandidates ?? data.degraded?.actionCandidates ?? []);
    } catch (err) {
      console.warn("[CommandCenter] handoff fetch errored (non-blocking)", err);
    }
  }

  /**
   * W49 (GAP #2) — persist a completed Command Center generation to the
   * documents collection so it appears in the Library, mirroring
   * DepartmentRoom's saveDocument pattern. agent_name resolves from the
   * routed agentId via the roster endpoint, falling back to the department
   * label. Fire-and-forget; a failed save never disturbs the chat.
   */
  async function saveGeneratedDocument(
    department: string,
    task: string,
    output: string,
    userId: string,
    agentId?: string
  ): Promise<string | undefined> {
    try {
      let agentName = DEPT_LABELS[department] ?? department;
      if (agentId) {
        try {
          const rosterRes = await fetch(`/api/agents/${encodeURIComponent(department)}?userId=${encodeURIComponent(userId)}`);
          if (rosterRes.ok) {
            const roster = (await rosterRes.json()) as Array<{ id: string; name: string }>;
            agentName = roster.find((a) => a.id === agentId)?.name ?? agentName;
          }
        } catch { /* fall back to department label */ }
      }
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      const rec = await pb.collection("documents").create({
        user: userId,
        department,
        agent_name: agentName,
        prompt: task,
        output,
        client: activeClientId ?? "",
      });
      // V4b pattern — fire-and-forget Vault ingestion enqueue.
      void fetch("/api/vault/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: rec.id, kind: "document", pbToken: pb.authStore.token }),
      }).catch(() => {});
      return rec.id;
    } catch (err) {
      console.error("[W49] Command Center document save failed:", err);
      return undefined;
    }
  }

  async function runAgent(department: string, task: string, userId: string, pbToken: string, agentId?: string) {
    setOutputBuffer("");
    setFollowUps([]); // clear any previous handoff suggestions before this run
    setActionCandidates([]);
    // Add a generating message placeholder
    setMessages((prev) => [...prev, { role: "assistant", content: "", isOutput: true }]);

    // PR-Tranche-2.6.3 (W28 fix) — hoist the streamed result to function
    // scope so the `finally` block reads the ACTUAL streamed text instead
    // of the stale React-state closure of `outputBuffer`. React state
    // updates queue for future renders; the running `finally` closure
    // sees the pre-stream value (empty). Without this hoist,
    // `completedOutput.length > 50` always fails and the handoff fetch
    // never fires — the visible W28 symptom.
    let streamedResult = "";
    let savedDocIdPromise: Promise<string | undefined> | undefined;

    try {
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          department,
          // Hotfix A2 — orchestrator-picked specialist id (when set).
          // Without this, /api/agent falls back to the dept's first-listed
          // agent, which routed SEO questions to the Content Creator.
          agentId: agentId || undefined,
          userId,
          pbToken,
          clientId: activeClientId ?? undefined,
          // Phase 9 — threadId persists conversation turns across reloads.
          threadId: threadId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Agent failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // PR-Tranche-2.6.3 — accumulate into the function-scope hoist;
        // setOutputBuffer is retained for the streaming UI render but
        // is no longer the source of truth for the finally block.
        streamedResult += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: streamedResult, isOutput: true };
          return updated;
        });
        setOutputBuffer(streamedResult);
        scrollToBottom();
      }

      // W49 (GAP #2) — success path only (Decision 3: failed generations
      // don't persist; the catch below never reaches this line).
      if (streamedResult.trim().length > 0 && userId) {
        // W62 — capture the save promise so the handoff request can carry
        // the document id (server persists action_candidates onto it).
        savedDocIdPromise = saveGeneratedDocument(department, task, streamedResult, userId, agentId);
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: "Something went wrong. Try again.", isOutput: false };
        return updated;
      });
    } finally {
      setPhase("done");
      setPendingAction(null);
      setTimeout(scrollToBottom, 100);

      // PR-Tranche-2.6 (W28) — fire handoff suggestions after generation
      // completes. PR-Tranche-2.6.3 fix: read from `streamedResult`
      // (function-scope accumulator) NOT `outputBuffer` (React-state
      // closure — captured stale at runAgent call time, never updated
      // by the stream's setState calls).
      const completedOutput = streamedResult;
      const userGoal = (() => {
        // Most recent user message is the last { role: "user" } before
        // this generation kicked off
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]!;
          if (m.role === "user") return m.content;
        }
        return task;
      })();
      setLastCompleted({ department, task, output: completedOutput, userGoal });
      // PR-Tranche-2.6.5 (W38) — skip handoff fetch when agent is asking
      // a clarifying question. Handoff suggestions are nonsense if the
      // work isn't done — the user needs to answer first.
      if (
        completedOutput &&
        completedOutput.length > 50 &&
        !isAgentAskingQuestion(completedOutput)
      ) {
        void fetchHandoffSuggestions(department, task, completedOutput, userGoal, userId, pbToken, savedDocIdPromise);
      }
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
    setPhase("idle");
    setPendingAction(null);
    setOutputBuffer("");
    setLastLockedAlt(null);
    // PR-Tranche-2.6 (W28) — clear handoff state on explicit reset
    setFollowUps([]);
    setLastCompleted(null);
    // Phase 9 — rotate the threadId on reset so the next chat is a fresh
    // conversation. Server-side `conversations` rows stay intact under the
    // old threadId for future thread-picker UX.
    if (typeof window !== "undefined") {
      try {
        const fresh = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        window.localStorage.setItem(THREAD_STORAGE_KEY, fresh);
        setThreadId(fresh);
      } catch { /* silent */ }
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const isWorking = phase === "routing" || phase === "generating";

  // Strip the READY:{...} line from display
  function cleanContent(content: string) {
    return content.replace(/\nREADY:\{.+?\}/s, "").replace(/READY:\{.+?\}/s, "").trim();
  }

  return (
    <div
      className="rounded-2xl overflow-hidden mb-8"
      style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.3)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: "1px solid #1E1E2A" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-base"
            style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.35)" }}
          >
            ⚡
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>Command Center</p>
            <p className="text-xs" style={{ color: "#5A5A70" }}>Tell me what you need — I'll route it to the right specialist</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Phase 25 — thread picker entry point. Always visible so users
              know past conversations are recoverable. */}
          <button
            onClick={() => setThreadPickerOpen(true)}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#A07BFF" }}
            title="Switch, rename, or archive past threads"
          >
            Threads
          </button>
          {messages.length > 0 && (
            <button
              onClick={reset}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#3A3A55" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Phase 25 — thread picker drawer. Renders nothing when closed. */}
      <ThreadPickerDrawer
        open={threadPickerOpen}
        onClose={() => setThreadPickerOpen(false)}
        currentThreadId={threadId}
        onSwitch={switchToThread}
        onNewThread={reset}
      />

      {/* Phase 29 — suggested prompts row. Only rendered before the first
          message so the chrome stays clean during conversations. */}
      {messages.length === 0 && phase === "idle" && (
        <CommandCenterSuggestions onPick={(prompt) => { setInput(prompt); setTimeout(() => void send(prompt), 0); }} />
      )}

      {/* Message thread — PR-Tranche-2.6 (W29): removed `max-h-96
          overflow-y-auto` which capped the thread at 384px and forced
          internal scroll while page space sat unused. Matches
          DepartmentRoom semantics — content flows, page scrolls. */}
      {messages.length > 0 && (
        <div className="px-5 py-4 flex flex-col gap-3">
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div
                    className="max-w-xs px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm"
                    style={{ background: "rgba(91,33,232,0.18)", color: "#F0F0F8", border: "1px solid rgba(91,33,232,0.25)" }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            const display = cleanContent(msg.content);
            const isReady = msg.content.includes("READY:");
            const isExec = msg.content.startsWith("EXECUTE:");

            if (isExec) return null;

            return (
              <div key={i} className="flex flex-col gap-1">
                {msg.isOutput ? (
                  // Generated document output
                  <>
                    {/* Locked-match nudge — appears when a better-fit dept is locked */}
                    {phase === "done" && lastLockedAlt && DEPT_LABELS[lastLockedAlt] && (
                      <div
                        className="rounded-xl px-4 py-3 mb-2 flex items-center gap-3"
                        style={{ background: "rgba(91,33,232,0.08)", border: "1px solid rgba(91,33,232,0.25)" }}
                      >
                        <span style={{ fontSize: "16px" }}>💡</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs" style={{ color: "#D0D0E8", lineHeight: 1.5 }}>
                            We routed this to your team. <strong style={{ color: "#A07BFF" }}>{DEPT_LABELS[lastLockedAlt]}</strong> would be a sharper fit.
                          </p>
                          <a
                            href={DEPT_HREFS[lastLockedAlt] ?? "/dashboard"}
                            className="text-xs font-semibold"
                            style={{ color: "#A07BFF", textDecoration: "none" }}
                          >
                            Try it free →
                          </a>
                        </div>
                      </div>
                    )}
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "#0D0D16", border: "1px solid #2A2A38" }}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#5B21E8" }} />
                        <span className="text-xs font-semibold" style={{ color: "#7070A0" }}>Generated</span>
                        {display && (
                          <button
                            onClick={() => navigator.clipboard.writeText(display)}
                            className="ml-auto text-xs transition-colors hover:text-white"
                            style={{ color: "#5A5A70" }}
                          >
                            Copy
                          </button>
                        )}
                      </div>
                      {display ? (
                        <div className="agent-output text-xs">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
                        </div>
                      ) : (
                        <span className="inline-block w-0.5 h-3.5 animate-pulse" style={{ background: "#5B21E8", verticalAlign: "middle" }} />
                      )}
                    </div>
                  </>
                ) : (
                  // Coordinator message
                  <div className="flex gap-2.5">
                    <div
                      className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center text-sm mt-0.5"
                      style={{ background: "rgba(91,33,232,0.15)" }}
                    >
                      ⚡
                    </div>
                    <div className="flex-1">
                      {display && (
                        <p className="text-sm" style={{ color: "#D0D0E8", lineHeight: "1.7" }}>
                          {display}
                        </p>
                      )}
                      {!display && isWorking && (
                        <span className="inline-block w-0.5 h-3.5 animate-pulse" style={{ background: "#5B21E8", verticalAlign: "middle" }} />
                      )}
                      {/* Confirmation prompt */}
                      {isReady && !isWorking && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => void send("yes")}
                            className="btn-primary px-4 py-1.5 rounded-lg text-xs font-semibold text-white"
                          >
                            Yes, run it →
                          </button>
                          <button
                            onClick={reset}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium transition-colors hover:text-white"
                            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#5A5A70" }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* PR-Tranche-2.6 (W28) — cross-functional handoff suggestions.
              Rendered after the message thread; only when phase is done
              (output is complete) and the handoff intent returned
              suggestions. Empty array → renders nothing. */}
          {phase === "done" && (followUps.length > 0 || actionCandidates.length > 0) && lastCompleted && (
            <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid #1E1E2A" }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
                Next steps
              </p>
              <div className="flex flex-wrap gap-2">
                {followUps.map((f, i) => {
                  const deptLabel = DEPT_LABELS[f.department] ?? f.department;
                  const dimmed = f.locked === true;
                  return (
                    <button
                      key={`${f.department}-${i}`}
                      onClick={() => {
                        // Locked dept → route to its dashboard page as an upsell;
                        // unlocked → submit the suggested task as the next turn
                        if (dimmed) {
                          window.location.href = DEPT_HREFS[f.department] ?? "/dashboard";
                          return;
                        }
                        // PR-Tranche-2.6.4 (W35) — bypass orchestrate +
                        // confirm gate. Button click IS explicit consent;
                        // the followUp already knows target dept.
                        void send(f.task, { skipConfirm: true, preselectDept: f.department });
                      }}
                      title={f.rationale ?? `Send to ${deptLabel}`}
                      className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:text-white"
                      style={{
                        background: dimmed ? "rgba(91,33,232,0.05)" : "rgba(91,33,232,0.12)",
                        border: `1px solid ${dimmed ? "rgba(91,33,232,0.15)" : "rgba(91,33,232,0.30)"}`,
                        color: dimmed ? "#5A5A70" : "#A07BFF",
                        cursor: "pointer",
                      }}
                    >
                      {dimmed ? "🔒 " : ""}
                      {deptLabel} · {f.task.length > 60 ? f.task.slice(0, 60) + "…" : f.task}
                    </button>
                  );
                })}
              </div>

              {/* W63 — the platform-action axis (W62 candidates), rendered
                  beneath the cross-department chips. D10' coexistence: the
                  static affordances elsewhere stay untouched until W64. */}
              <ActionAffordances
                candidates={actionCandidates}
                context={{ department: lastCompleted.department }}
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input — PR-Tranche-2.5 (W26 fix): always visible while the chat has
          life, including after phase === "done". The textarea is disabled
          during in-flight work (isWorking), but visible — the user has a
          clear affordance to continue the conversation. */}
      <div style={{ borderTop: messages.length > 0 ? "1px solid #1E1E2A" : "none" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={
            pendingAction
              ? "Type yes to confirm, or describe something different…"
              : messages.length === 0
                ? "What do you need? — e.g. 'write an invoice for a client' or 'I need to hire a designer'…"
                : // PR-Tranche-2.6.5 (W39) — when agent's most recent message
                  // ends in a question, switch placeholder + signal answer mode
                  agentAwaitingReply
                  ? "Type your reply…"
                  : phase === "done"
                    ? "Refine, follow up, or ask for something else…"
                    : "Reply…"
          }
          rows={messages.length === 0 ? 2 : 1}
          disabled={isWorking}
          className="w-full px-5 py-4 text-sm outline-none resize-none"
          style={{
            background: "transparent",
            color: "#F0F0F8",
            lineHeight: "1.6",
            caretColor: "#5B21E8",
            opacity: isWorking ? 0.5 : 1,
          }}
        />
        <div className="flex items-center justify-between px-5 pb-3">
          <span className="text-xs" style={{ color: "#2E2E45" }}>
            {isWorking ? (
              <span className="flex items-center gap-1.5" style={{ color: "#5A5A70" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
                {phase === "generating" ? "generating…" : "thinking…"}
              </span>
            ) : phase === "done" ? (
              <span style={{ color: "#5A5A70" }}>
                Enter to continue · or{" "}
                <button
                  onClick={reset}
                  className="underline transition-colors hover:text-white"
                  style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  start fresh
                </button>
              </span>
            ) : "Enter to send"}
          </span>
          <button
            onClick={() => void send()}
            disabled={!input.trim() || isWorking}
            className="btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold text-white"
            style={{ opacity: !input.trim() || isWorking ? 0.3 : 1, cursor: !input.trim() || isWorking ? "not-allowed" : "pointer" }}
          >
            Send →
          </button>
        </div>
      </div>
    </div>
  );
}
