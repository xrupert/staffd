"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";
import { exportToDocx } from "./DocExport";

export interface QuickAction {
  label: string;
  prompt: string;
}

export interface AgentPageConfig {
  department: string;
  icon: string;
  title: string;
  eyebrow?: string;
  tagline: string;
  agentName: string;
  generatingWord?: string;
  quickActions: QuickAction[];
  placeholder: string;
}

export default function AgentPage({
  department,
  icon,
  title,
  eyebrow = "Department",
  tagline,
  agentName,
  generatingWord = "Writing",
  quickActions,
  placeholder,
}: AgentPageConfig) {
  const [task, setTask] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeChip, setActiveChip] = useState("");
  const [businessName, setBusinessName] = useState<string>("");
  const outputRef = useRef<HTMLDivElement>(null);

  async function run(customTask?: string) {
    const finalTask = (customTask ?? task).trim();
    if (!finalTask || loading) return;
    setOutput("");
    setError("");
    setLoading(true);

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    // Try to get business name for document headers
    if (!businessName && pbToken && userId) {
      try {
        const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
        const res = await fetch(
          `${pbUrl}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
          { headers: { Authorization: pbToken } }
        );
        const data = await res.json() as { items?: { business_name?: string }[] };
        setBusinessName(data.items?.[0]?.business_name ?? "");
      } catch {
        // proceed without
      }
    }

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: finalTask, department, userId, pbToken }),
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

  function handleQuickAction(a: QuickAction) {
    setActiveChip(a.prompt);
    setTask(a.prompt);
    void run(a.prompt);
  }

  function handlePrint() {
    window.print();
  }

  async function handleWord() {
    if (!output) return;
    await exportToDocx(output, businessName || undefined);
  }

  return (
    <main
      className="min-h-screen flex flex-col no-print-chrome"
      style={{ background: "#09090F" }}
    >
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none no-print"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      <div
        className="fixed pointer-events-none no-print"
        style={{
          top: "-150px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "700px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.1) 0%, transparent 65%)",
        }}
      />

      {/* Print-only header — invisible on screen */}
      <div className="print-only print-header">
        {businessName && <span className="print-biz-name">{businessName}</span>}
        <div className="print-divider" />
      </div>

      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8 flex flex-col flex-1">

        {/* Nav header */}
        <header className="flex items-center justify-between mb-12 no-print">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>
            ← Dashboard
          </a>
        </header>

        {/* Dept title */}
        <div className="mb-8 no-print">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ background: "rgba(91,33,232,0.15)", border: "1px solid rgba(91,33,232,0.25)" }}
            >
              {icon}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: "#5B21E8" }}>
                {eyebrow}
              </p>
              <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem", lineHeight: 1.2, letterSpacing: "-0.01em" }}>
                {title}
              </h1>
            </div>
          </div>
          <p className="text-sm" style={{ color: "#9090A8" }}>{tagline}</p>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 mb-5 no-print">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => handleQuickAction(a)}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                background: activeChip === a.prompt ? "rgba(91,33,232,0.2)" : "#111118",
                border: activeChip === a.prompt ? "1px solid rgba(91,33,232,0.45)" : "1px solid #2A2A38",
                color: activeChip === a.prompt ? "#A07BFF" : "#9090A8",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div className="rounded-2xl overflow-hidden mb-5 no-print" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <textarea
            value={task}
            onChange={(e) => { setTask(e.target.value); setActiveChip(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run(); }}
            placeholder={placeholder}
            rows={4}
            className="w-full px-5 py-4 text-sm outline-none resize-none"
            style={{ background: "transparent", color: "#F0F0F8", lineHeight: "1.7", caretColor: "#5B21E8" }}
          />
          <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid #1E1E2A" }}>
            <span className="text-xs" style={{ color: "#2E2E45" }}>⌘ Enter to run</span>
            <button
              onClick={() => void run()}
              disabled={!task.trim() || loading}
              className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ opacity: !task.trim() || loading ? 0.35 : 1, cursor: !task.trim() || loading ? "not-allowed" : "pointer" }}
            >
              {loading ? `${generatingWord}…` : "Generate →"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="px-4 py-3 rounded-xl text-xs mb-4 no-print"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
          >
            {error}
          </div>
        )}

        {/* Output panel */}
        {(output || loading) && (
          <div
            ref={outputRef}
            className="rounded-2xl overflow-hidden flex-1"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            {/* Output toolbar */}
            <div
              className="flex items-center justify-between px-5 py-3 no-print"
              style={{ borderBottom: "1px solid #1E1E2A" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-sm"
                  style={{ background: "rgba(91,33,232,0.15)" }}
                >
                  {icon}
                </div>
                <span className="text-xs font-semibold" style={{ color: "#9090A8" }}>{agentName}</span>
                {loading && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "#5A5A70" }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
                    {generatingWord.toLowerCase()}
                  </span>
                )}
              </div>

              {/* Action buttons — only when done */}
              {output && !loading && (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => navigator.clipboard.writeText(output)}
                    className="text-xs transition-colors hover:text-white"
                    style={{ color: "#5A5A70" }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={handlePrint}
                    className="text-xs transition-colors hover:text-white"
                    style={{ color: "#5A5A70" }}
                  >
                    Save PDF
                  </button>
                  <button
                    onClick={() => void handleWord()}
                    className="text-xs transition-colors hover:text-white"
                    style={{ color: "#5A5A70" }}
                  >
                    Download .docx
                  </button>
                </div>
              )}
            </div>

            {/* Output body */}
            <div className="px-6 py-5">
              {loading ? (
                // During streaming: plain preformatted text
                <div className="text-sm whitespace-pre-wrap" style={{ color: "#D0D0E8", lineHeight: "1.8" }}>
                  {output}
                  <span
                    className="inline-block w-0.5 h-4 ml-0.5 animate-pulse"
                    style={{ background: "#5B21E8", verticalAlign: "middle" }}
                  />
                </div>
              ) : (
                // After complete: rendered markdown
                <div className="agent-output">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {output}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Vault nudge */}
        {!output && !loading && (
          <div className="mt-auto pt-8 pb-4 no-print">
            <a
              href="/dashboard/vault"
              className="flex items-center gap-3 text-xs group"
              style={{ color: "#3A3A55", textDecoration: "none" }}
            >
              <span>🔐</span>
              <span className="group-hover:text-purple-400 transition-colors">
                Add your business details to the Vault and your AI team will use them automatically →
              </span>
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
