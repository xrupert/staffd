"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../../lib/pb";

const DEPT_OPTIONS = [
  { value: "", label: "Any department" },
  { value: "marketing", label: "📣 Marketing" },
  { value: "sales", label: "🤝 Sales" },
  { value: "legal", label: "⚖️ Legal" },
  { value: "hr", label: "👥 HR" },
  { value: "finance", label: "💰 Finance" },
  { value: "operations", label: "⚙️ Operations" },
  { value: "ceo", label: "🎯 CEO / Strategy" },
];

interface Template {
  id: string;
  name: string;
  department: string;
  content: string;
  created: string;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");

  // New template form state
  const [newName, setNewName] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newContent, setNewContent] = useState("");

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("templates").getList(1, 200, {
        filter: `user = '${userId}'`,
        sort: "name",
      });
      setTemplates(res.items as unknown as Template[]);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveTemplate() {
    if (!newName.trim() || !newContent.trim()) { setError("Name and content are required."); return; }
    setSaving(true);
    setError("");
    try {
      const userId = pb.authStore.record?.id ?? "";
      const rec = await pb.collection("templates").create({
        user: userId,
        name: newName.trim(),
        department: newDept,
        content: newContent.trim(),
      });
      setTemplates((prev) => [rec as unknown as Template, ...prev]);
      setNewName(""); setNewDept(""); setNewContent("");
      setCreating(false);
    } catch {
      setError("Failed to save template. Make sure your PocketBase setup is complete.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    setDeleting(id);
    try {
      await pb.collection("templates").delete(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (expanded === id) setExpanded(null);
    } catch { /* ignore */ } finally {
      setDeleting(null);
    }
  }

  const inputStyle: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" };

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`, backgroundSize: "64px 64px" }} />

      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-12">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>← Dashboard</a>
        </header>

        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Templates</p>
            <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              Your Document Templates
            </h1>
            <p className="text-sm" style={{ color: "#5A5A70" }}>
              Save your invoice formats, contract structures, or any document layout.<br />
              Your agents will use them as the base for new documents.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex-shrink-0 ml-4"
            >
              + New
            </button>
          )}
        </div>

        {/* Create form */}
        {creating && (
          <div className="rounded-2xl p-6 mb-6" style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.3)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-5" style={{ color: "#5A5A70" }}>New Template</p>

            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>Template name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., My Invoice Format, NDA Template"
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                    style={inputStyle}
                  />
                </div>
                <div className="w-44 flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>Department</label>
                  <select
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    {DEPT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>
                  Template content
                </label>
                <p className="text-xs" style={{ color: "#3A3A50" }}>
                  Paste your existing document, invoice, contract, or any format here. The agent will use this exact structure and fill in the details.
                </p>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Paste your document template here…&#10;&#10;Example:&#10;INVOICE&#10;Date: [DATE]&#10;Invoice #: [NUMBER]&#10;&#10;Bill To:&#10;[CLIENT NAME]&#10;[ADDRESS]&#10;&#10;Services:&#10;[DESCRIPTION] — $[AMOUNT]&#10;&#10;Total Due: $[TOTAL]"
                  rows={14}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none font-mono"
                  style={{ ...inputStyle, lineHeight: "1.6" }}
                />
              </div>

              {error && (
                <div className="px-4 py-3 rounded-xl text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => void saveTemplate()}
                  disabled={saving || !newName.trim() || !newContent.trim()}
                  className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ opacity: saving || !newName.trim() || !newContent.trim() ? 0.4 : 1 }}
                >
                  {saving ? "Saving…" : "Save Template"}
                </button>
                <button
                  onClick={() => { setCreating(false); setError(""); setNewName(""); setNewDept(""); setNewContent(""); }}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors hover:text-white"
                  style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#5A5A70" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Template list */}
        {loading ? (
          <div className="flex items-center gap-2 py-8" style={{ color: "#5A5A70" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
            <span className="text-sm">Loading…</span>
          </div>
        ) : templates.length === 0 && !creating ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <p className="text-sm mb-2" style={{ color: "#5A5A70" }}>No templates yet.</p>
            <p className="text-xs mb-5" style={{ color: "#3A3A50" }}>
              Save your invoice format, SOP structure, or any document layout.<br />
              Your agents will use it as the base for new documents.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            >
              Create your first template
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer"
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">📄</span>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "#F0F0F8" }}>{t.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#3A3A50" }}>
                        {t.department ? DEPT_OPTIONS.find((o) => o.value === t.department)?.label ?? t.department : "All departments"}
                        {" · "}{t.content.length} chars
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteTemplate(t.id); }}
                      disabled={deleting === t.id}
                      className="text-xs transition-colors hover:text-red-400"
                      style={{ color: "#3A3A50" }}
                    >
                      {deleting === t.id ? "Deleting…" : "Delete"}
                    </button>
                    <span className="text-xs" style={{ color: "#3A3A50" }}>{expanded === t.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expanded === t.id && (
                  <div className="px-5 pb-5" style={{ borderTop: "1px solid #1E1E2A" }}>
                    <pre
                      className="text-xs mt-4 overflow-x-auto"
                      style={{ color: "#9090A8", lineHeight: "1.7", whiteSpace: "pre-wrap", fontFamily: "Geist Mono, monospace" }}
                    >
                      {t.content}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && templates.length > 0 && (
          <p className="text-xs mt-6 text-center" style={{ color: "#3A3A50" }}>
            Select a template from any department page using the "Use a template" button.
          </p>
        )}
      </div>
    </main>
  );
}
