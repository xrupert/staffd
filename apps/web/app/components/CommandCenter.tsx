"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";

interface Message {
  role: "user" | "assistant";
  content: string;
  isOutput?: boolean;
  lockedAlternative?: string;
}

interface PendingAction {
  department: string;
  task: string;
  lockedAlternative?: string;
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

export default function CommandCenter() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [outputBuffer, setOutputBuffer] = useState("");
  const [lastLockedAlt, setLastLockedAlt] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const CONFIRM_WORDS = /^(yes|confirm|confirmed|approved|approve|go|do it|go ahead|sure|yep|yup|ok|okay|sounds good|make it|run it|let'?s go)/i;

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || phase === "routing" || phase === "generating") return;

    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    setPhase("routing");
    setTimeout(scrollToBottom, 50);

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

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
      await runAgent(pendingAction.department, pendingAction.task, userId, pbToken);
      return;
    }

    // Route through orchestrator
    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
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

  async function runAgent(department: string, task: string, userId: string, pbToken: string) {
    setOutputBuffer("");
    // Add a generating message placeholder
    setMessages((prev) => [...prev, { role: "assistant", content: "", isOutput: true }]);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, department, userId, pbToken }),
      });
      if (!res.ok) throw new Error("Agent failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");

      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: result, isOutput: true };
          return updated;
        });
        setOutputBuffer(result);
        scrollToBottom();
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
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
    setPhase("idle");
    setPendingAction(null);
    setOutputBuffer("");
    setLastLockedAlt(null);
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

      {/* Message thread */}
      {messages.length > 0 && (
        <div className="px-5 py-4 flex flex-col gap-3 max-h-96 overflow-y-auto">
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
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      {phase !== "done" && (
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
      )}

      {/* Done state: start new */}
      {phase === "done" && (
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderTop: "1px solid #1E1E2A" }}
        >
          <span className="text-xs" style={{ color: "#5A5A70" }}>Output generated</span>
          <button
            onClick={reset}
            className="text-xs font-medium transition-colors hover:text-white"
            style={{ color: "#A07BFF" }}
          >
            + New request
          </button>
        </div>
      )}
    </div>
  );
}
