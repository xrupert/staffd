"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../../lib/pb";

interface Client {
  id: string;
  name: string;
  industry: string;
  description: string;
  target_audience: string;
  website: string;
  phone: string;
  primary_email: string;
  address: string;
  focus: string;
  situation: string;
  superpower: string;
  magic_wand: string;
  status: string;
  created: string;
}

const FOCUS_OPTIONS = [
  { id: "growth",       label: "Top-Line Growth" },
  { id: "time",         label: "Time Recovery" },
  { id: "cx",           label: "Customer Experience" },
  { id: "intelligence", label: "Intelligence & Scaling" },
];

const SUPERPOWER_OPTIONS = [
  { id: "speed",         label: "Speed & Efficiency" },
  { id: "quality",       label: "Premium Quality / Expertise" },
  { id: "value",         label: "Cost-Effectiveness" },
  { id: "relationships", label: "Deep Relationships" },
];

const SITUATION_OPTIONS = [
  { id: "solo",     label: "Solo operator — out of hours" },
  { id: "skills",   label: "Small team, missing key skills" },
  { id: "scaling",  label: "Growing faster than they can hire" },
  { id: "cost",     label: "Needs expert work without expert cost" },
  { id: "chaos",    label: "Broken processes" },
  { id: "starting", label: "Just starting out" },
];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    // Ensure clients schema exists
    void fetch("/api/setup/clients", { method: "POST" }).catch(() => null);
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch(`/api/clients?userId=${userId}`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { clients: Client[] };
      setClients(data.clients ?? []);
    } catch { /* proceed */ }
    finally { setLoading(false); }
  }

  const activeClients = clients.filter((c) => c.status !== "archived");
  const filtered = activeClients.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name?.toLowerCase().includes(q) || c.industry?.toLowerCase().includes(q);
  });

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-12">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>
            ← Dashboard
          </a>
        </header>

        <div className="flex items-start justify-between mb-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Agency</p>
            <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "2rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              Your Clients
            </h1>
            <p className="text-sm" style={{ color: "#9090A8" }}>
              Manage every client you serve. Switch contexts from the header to act on their behalf.
            </p>
          </div>
          {!forbidden && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white flex-shrink-0"
              style={{ background: "#5B21E8", border: "none", cursor: "pointer" }}
            >
              + Add a client
            </button>
          )}
        </div>

        {forbidden && (
          <div
            className="rounded-2xl p-10 text-center"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔒</div>
            <h2 className="text-lg font-bold mb-2" style={{ color: "#F0F0F8" }}>Multi-client is an Agency feature</h2>
            <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: "#9090A8" }}>
              The Agency plan gives you a multi-client dashboard, white-label options, and the ability to staff every department for every client.
            </p>
            <a
              href="/pricing"
              className="inline-block px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: "#5B21E8", textDecoration: "none" }}
            >
              See Agency plan →
            </a>
          </div>
        )}

        {!forbidden && !loading && activeClients.length === 0 && (
          <div
            className="rounded-2xl p-10 text-center"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>👥</div>
            <h2 className="text-lg font-bold mb-2" style={{ color: "#F0F0F8" }}>No clients on your roster yet</h2>
            <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: "#9090A8" }}>
              Add your first client to start managing their staff. Each client gets their own vault, work history, and brand context.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: "#5B21E8", border: "none", cursor: "pointer" }}
            >
              + Add your first client
            </button>
          </div>
        )}

        {!forbidden && !loading && activeClients.length > 0 && (
          <>
            {/* Search */}
            <div className="mb-5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients by name or industry…"
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              <div className="rounded-xl px-5 py-4" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <p className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8" }}>{activeClients.length}</p>
                <p className="text-xs" style={{ color: "#5A5A70" }}>Active clients</p>
              </div>
              <div className="rounded-xl px-5 py-4" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <p className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8" }}>
                  {activeClients.filter((c) => c.industry?.trim()).length}
                </p>
                <p className="text-xs" style={{ color: "#5A5A70" }}>Industries covered</p>
              </div>
              <div className="rounded-xl px-5 py-4" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <p className="text-2xl font-bold mb-1" style={{ color: "#A07BFF" }}>10</p>
                <p className="text-xs" style={{ color: "#5A5A70" }}>Departments per client</p>
              </div>
            </div>

            {/* Client grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setEditing(c)}
                  className="rounded-xl p-5 text-left transition-all"
                  style={{ background: "#111118", border: "1px solid #2A2A38", cursor: "pointer" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(91,33,232,0.4)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#2A2A38"; }}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                      style={{ background: "rgba(91,33,232,0.15)", border: "1px solid rgba(91,33,232,0.25)", color: "#A07BFF", fontWeight: 700, fontSize: "14px" }}
                    >
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "#F0F0F8" }}>{c.name}</p>
                      {c.industry && (
                        <p className="text-xs mt-0.5" style={{ color: "#7070A0" }}>{c.industry}</p>
                      )}
                    </div>
                  </div>
                  {c.description && (
                    <p className="text-xs leading-snug" style={{ color: "#5A5A70" }}>
                      {c.description.length > 100 ? c.description.slice(0, 100) + "…" : c.description}
                    </p>
                  )}
                  <p className="text-xs mt-3" style={{ color: "#A07BFF" }}>Edit profile →</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {showAdd && (
        <ClientFormModal
          mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); void load(); }}
        />
      )}
      {editing && (
        <ClientFormModal
          mode="edit"
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </main>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

interface ClientFormModalProps {
  mode: "create" | "edit";
  client?: Client;
  onClose: () => void;
  onSaved: () => void;
}

function ClientFormModal({ mode, client, onClose, onSaved }: ClientFormModalProps) {
  const [name, setName] = useState(client?.name ?? "");
  const [industry, setIndustry] = useState(client?.industry ?? "");
  const [description, setDescription] = useState(client?.description ?? "");
  const [targetAudience, setTargetAudience] = useState(client?.target_audience ?? "");
  const [website, setWebsite] = useState(client?.website ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [primaryEmail, setPrimaryEmail] = useState(client?.primary_email ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [focus, setFocus] = useState(client?.focus ?? "");
  const [situation, setSituation] = useState(client?.situation ?? "");
  const [superpower, setSuperpower] = useState(client?.superpower ?? "");
  const [magicWand, setMagicWand] = useState(client?.magic_wand ?? "");

  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) { setError("Client name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const userId = pb.authStore.record?.id ?? "";
      const payload = {
        userId, name, industry, description,
        target_audience: targetAudience, website, phone,
        primary_email: primaryEmail, address,
        focus, situation, superpower, magic_wand: magicWand,
      };
      const url = mode === "create" ? "/api/clients" : `/api/clients/${client?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      onSaved();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!client) return;
    if (!confirm(`Archive ${client.name}? Their data stays accessible but they're removed from the active roster.`)) return;
    setArchiving(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch(`/api/clients/${client.id}?userId=${userId}`, { method: "DELETE" });
      if (res.ok) onSaved();
      else setError("Failed to archive");
    } catch {
      setError("Network error");
    } finally {
      setArchiving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "#0D0D14", border: "1px solid #2A2A38", color: "#F0F0F8",
    borderRadius: "10px", padding: "9px 12px", fontSize: "13px", outline: "none", width: "100%",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "11px", fontWeight: 600, marginBottom: "5px", color: "#9090A8",
    textTransform: "uppercase", letterSpacing: "0.08em",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl"
        style={{ background: "#0D0D14", border: "1px solid #2A2A38", maxHeight: "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-7 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid #1E1E2A", position: "sticky", top: 0, background: "#0D0D14", zIndex: 10 }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#5B21E8" }}>
              {mode === "create" ? "Add Client" : "Edit Client"}
            </p>
            <h2 className="text-lg font-bold" style={{ color: "#F0F0F8", letterSpacing: "-0.01em" }}>
              {mode === "create" ? "Bring a new client onto your roster" : client?.name}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "20px" }}>×</button>
        </div>

        {/* Body */}
        <div className="px-7 py-5 flex flex-col gap-5">
          {/* Basics */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#3A3A50" }}>Business basics</p>
            <div className="flex flex-col gap-3">
              <div>
                <label style={labelStyle}>Client name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Co." style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Industry</label>
                <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. SaaS, plumbing, e-commerce" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What they do, who for, what makes it work" style={{ ...inputStyle, resize: "none" }} />
              </div>
              <div>
                <label style={labelStyle}>Target customers</label>
                <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="Their ideal customer" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Website</label>
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Contact */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#3A3A50" }}>Contact details</p>
            <div className="flex flex-col gap-3">
              <div>
                <label style={labelStyle}>Primary email</label>
                <input value={primaryEmail} onChange={(e) => setPrimaryEmail(e.target.value)} placeholder="hello@example.com" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Address</label>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Business address used on docs and invoices" style={{ ...inputStyle, resize: "none" }} />
              </div>
            </div>
          </div>

          {/* Strategy */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#3A3A50" }}>Their strategic context</p>
            <div className="flex flex-col gap-3">
              <div>
                <label style={labelStyle}>Primary focus</label>
                <select value={focus} onChange={(e) => setFocus(e.target.value)} style={inputStyle}>
                  <option value="">Select…</option>
                  {FOCUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Current situation</label>
                <select value={situation} onChange={(e) => setSituation(e.target.value)} style={inputStyle}>
                  <option value="">Select…</option>
                  {SITUATION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Competitive edge</label>
                <select value={superpower} onChange={(e) => setSuperpower(e.target.value)} style={inputStyle}>
                  <option value="">Select…</option>
                  {SUPERPOWER_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>What they most want off their plate</label>
                <textarea value={magicWand} onChange={(e) => setMagicWand(e.target.value)} rows={2} placeholder="Optional but powerful — shapes how their staff prioritizes" style={{ ...inputStyle, resize: "none" }} />
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-5 flex items-center justify-between" style={{ borderTop: "1px solid #1E1E2A", position: "sticky", bottom: 0, background: "#0D0D14" }}>
          <div>
            {mode === "edit" && (
              <button
                onClick={() => void archive()}
                disabled={archiving}
                className="text-xs"
                style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer" }}
              >
                {archiving ? "Archiving…" : "Archive client"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#9090A8", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || !name.trim()}
              className="px-5 py-2 rounded-lg text-xs font-semibold text-white"
              style={{
                background: "#5B21E8", border: "none",
                cursor: saving || !name.trim() ? "not-allowed" : "pointer",
                opacity: saving || !name.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : mode === "create" ? "Add to roster" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
