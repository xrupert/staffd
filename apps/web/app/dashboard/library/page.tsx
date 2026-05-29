"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../../lib/pb";
import { exportToDocx } from "../../components/DocExport";

const DEPT_ICONS: Record<string, string> = {
  marketing: "📣",
  sales: "🤝",
  legal: "⚖️",
  hr: "👥",
  finance: "💰",
  operations: "⚙️",
  ceo: "🎯",
  "paid-media": "📈",
  design: "🎨",
  reputation: "🛡️",
};

const DEPARTMENTS = ["All", "marketing", "sales", "legal", "hr", "finance", "operations", "ceo", "paid-media", "design", "reputation"];

interface Doc {
  id: string;
  department: string;
  agent_name: string;
  prompt: string;
  output: string;
  created: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function LibraryPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    void loadDocs();
    void loadBusinessName();
  }, []);

  async function loadBusinessName() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("businesses").getList(1, 1, { filter: `user = '${userId}'` });
      setBusinessName((res.items[0]?.business_name as string) ?? "");
    } catch { /* no vault */ }
  }

  async function loadDocs() {
    setLoading(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      // When an Agency user is acting on behalf of a client, scope the library
      // to that client's work. Otherwise show everything the user has produced.
      const filter = activeClientId
        ? `user = '${userId}' && client = '${activeClientId}'`
        : `user = '${userId}'`;
      const res = await pb.collection("documents").getList(1, 200, {
        filter,
        sort: "-created",
      });
      setDocs(res.items as unknown as Doc[]);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }

  async function deleteDoc(id: string) {
    setDeleting(id);
    try {
      await pb.collection("documents").delete(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      if (expanded === id) setExpanded(null);
    } catch { /* ignore */ } finally {
      setDeleting(null);
    }
  }

  const filtered = docs.filter((d) => {
    if (filter !== "All" && d.department !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return d.prompt.toLowerCase().includes(q) || d.output.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`, backgroundSize: "64px 64px" }} />

      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-12">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>← Dashboard</a>
        </header>

        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Document Library</p>
          <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Your Generated Documents
          </h1>
          <p className="text-sm" style={{ color: "#5A5A70" }}>
            Every document your staff has produced, saved automatically.
          </p>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
          />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-6">
          {DEPARTMENTS.map((d) => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all capitalize"
              style={{
                background: filter === d ? "rgba(91,33,232,0.2)" : "#111118",
                border: filter === d ? "1px solid rgba(91,33,232,0.45)" : "1px solid #2A2A38",
                color: filter === d ? "#A07BFF" : "#5A5A70",
              }}
            >
              {d === "All" ? "All" : `${DEPT_ICONS[d] ?? ""} ${d.charAt(0).toUpperCase() + d.slice(1)}`}
            </button>
          ))}
        </div>

        {/* Document list */}
        {loading ? (
          <div className="flex items-center gap-2 py-12" style={{ color: "#5A5A70" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
            <span className="text-sm">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm mb-2" style={{ color: "#5A5A70" }}>
              {docs.length === 0 ? "No documents yet — generate something from any department." : "No documents match your search."}
            </p>
            {docs.length === 0 && (
              <a href="/dashboard" className="text-sm font-medium" style={{ color: "#5B21E8" }}>Go to Dashboard →</a>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                className="rounded-2xl overflow-hidden"
                style={{ background: "#111118", border: "1px solid #2A2A38" }}
              >
                {/* Card header */}
                <div
                  className="flex items-start gap-3 px-5 py-4 cursor-pointer"
                  onClick={() => setExpanded(expanded === doc.id ? null : doc.id)}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0 mt-0.5"
                    style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.2)" }}
                  >
                    {DEPT_ICONS[doc.department] ?? "📄"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate mb-0.5" style={{ color: "#F0F0F8" }}>
                      {doc.prompt.length > 90 ? doc.prompt.slice(0, 90) + "…" : doc.prompt}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs capitalize" style={{ color: "#5A5A70" }}>{doc.agent_name || doc.department}</span>
                      <span className="text-xs" style={{ color: "#3A3A50" }}>·</span>
                      <span className="text-xs" style={{ color: "#3A3A50" }}>{timeAgo(doc.created)}</span>
                    </div>
                  </div>
                  <span className="text-xs ml-2 flex-shrink-0 mt-1" style={{ color: "#3A3A50" }}>
                    {expanded === doc.id ? "▲" : "▼"}
                  </span>
                </div>

                {/* Expanded content */}
                {expanded === doc.id && (
                  <div style={{ borderTop: "1px solid #1E1E2A" }}>
                    <div className="flex items-center justify-between px-5 py-2.5" style={{ borderBottom: "1px solid #1E1E2A" }}>
                      <span className="text-xs" style={{ color: "#5A5A70" }}>Output</span>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/doc/${doc.id}`;
                            void navigator.clipboard.writeText(url).then(() => {
                              setCopied(doc.id);
                              setTimeout(() => setCopied(null), 2000);
                            });
                          }}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: copied === doc.id ? "#22C55E" : "#5A5A70" }}
                        >
                          {copied === doc.id ? "Link copied ✓" : "Share"}
                        </button>
                        <button onClick={() => void navigator.clipboard.writeText(doc.output)} className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70" }}>Copy</button>
                        <button onClick={() => window.print()} className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70" }}>Save PDF</button>
                        <button onClick={() => void exportToDocx(doc.output, businessName || undefined)} className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70" }}>Download .docx</button>
                        <button
                          onClick={() => void deleteDoc(doc.id)}
                          disabled={deleting === doc.id}
                          className="text-xs transition-colors hover:text-red-400"
                          style={{ color: "#3A3A50" }}
                        >
                          {deleting === doc.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                    <div className="px-5 py-5 agent-output" style={{ maxHeight: "480px", overflowY: "auto" }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.output}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
