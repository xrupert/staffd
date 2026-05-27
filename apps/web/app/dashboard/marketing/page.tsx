"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import pb from "../../../lib/pb";

const QUICK_ACTIONS = [
  { label: "Social post", prompt: "Write a social media post I can publish today." },
  { label: "Blog intro", prompt: "Write a compelling blog post introduction for my business." },
  { label: "Email to my list", prompt: "Draft a short email to send to my customer list." },
  { label: "Headline ideas", prompt: "Give me 5 headline ideas for my homepage or next campaign." },
  { label: "Ad copy", prompt: "Write short ad copy (headline + one sentence) I can run as a paid ad." },
  { label: "Bio / About", prompt: "Write a punchy 3-sentence bio or About section for my business." },
];

export default function MarketingPage() {
  const [task, setTask] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);

  async function run(customTask?: string) {
    const finalTask = (customTask ?? task).trim();
    if (!finalTask || loading) return;

    setOutput("");
    setError("");
    setLoading(true);

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: finalTask,
          department: "marketing",
          userId,
          pbToken,
        }),
      });

      if (!res.ok) throw new Error("Agent request failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setOutput(result);
        outputRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col relative" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8 flex flex-col flex-1">

        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm" style={{ color: "#5A5A70" }}>
            ← Dashboard
          </a>
        </header>

        {/* Title */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📣</span>
            <h1 className="text-2xl font-bold" style={{ color: "#F0F0F8" }}>Marketing</h1>
          </div>
          <p className="text-sm" style={{ color: "#9090A8" }}>
            Your AI marketer knows your business. Tell it what to create.
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-6">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => setTask(a.prompt)}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: "#111118",
                border: "1px solid #2A2A38",
                color: "#9090A8",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div
          className="rounded-2xl overflow-hidden mb-4"
          style={{ background: "#111118", border: "1px solid #2A2A38" }}
        >
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
            placeholder="Describe what you need — or pick a quick action above…"
            rows={3}
            className="w-full px-5 py-4 text-sm outline-none resize-none"
            style={{ background: "transparent", color: "#F0F0F8", lineHeight: "1.6" }}
          />
          <div className="flex items-center justify-between px-4 pb-3">
            <span className="text-xs" style={{ color: "#3A3A50" }}>⌘ + Enter to run</span>
            <button
              onClick={() => run()}
              disabled={!task.trim() || loading}
              className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold text-white"
              style={{
                opacity: !task.trim() || loading ? 0.4 : 1,
                cursor: !task.trim() || loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Writing…" : "Generate →"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm mb-4" style={{ color: "#EF4444" }}>{error}</p>
        )}

        {/* Output */}
        {(output || loading) && (
          <div
            className="rounded-2xl p-6 flex-1"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: "#1A1A24", color: "#5B21E8" }}>
                The Marketer
              </span>
              {loading && (
                <span className="text-xs" style={{ color: "#5A5A70" }}>writing…</span>
              )}
            </div>
            <div
              ref={outputRef}
              className="text-sm whitespace-pre-wrap leading-relaxed"
              style={{ color: "#E0E0F0" }}
            >
              {output}
              {loading && <span className="inline-block w-0.5 h-4 ml-0.5 animate-pulse" style={{ background: "#5B21E8", verticalAlign: "middle" }} />}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
