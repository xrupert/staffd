"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../../lib/pb";

const FOCUS_LABELS: Record<string, string> = {
  growth: "🚀 Top-Line Growth",
  time: "⏳ Time Recovery",
  cx: "👥 Customer Experience",
  intelligence: "📊 Intelligence & Scaling",
};
const SITUATION_LABELS: Record<string, string> = {
  solo: "🧍 Doing everything myself",
  skills: "👥 Small team, missing key skills",
  scaling: "📈 Growing faster than I can hire",
  cost: "💸 Need expert work without expert cost",
  chaos: "🔄 Processes are broken",
  starting: "🌱 Just starting out",
};
const SUPERPOWER_LABELS: Record<string, string> = {
  speed: "⚡ Speed & Efficiency",
  quality: "💎 Premium Quality / Expertise",
  value: "💰 Cost-Effectiveness",
  relationships: "❤️ Deep Relationships",
};
const BOTTLENECK_LABELS: Record<string, string> = {
  content: "Content Creation & Marketing",
  leads: "Lead Generation & Outbound Sales",
  support: "Customer Support & Account Management",
  ops: "Data Entry, Invoicing & Ops Admin",
  research: "Market Research & Competitor Analysis",
};

interface VaultData {
  id?: string;
  business_name?: string;
  industry?: string;
  description?: string;
  target_audience?: string;
  website?: string;
  focus?: string;
  situation?: string;
  superpower?: string;
  bottlenecks?: string[];
  magic_wand?: string;
}

export default function VaultPage() {
  const [vault, setVault] = useState<VaultData>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    loadVault();
  }, []);

  async function loadVault() {
    try {
      const userId = pb.authStore.record?.id;
      const res = await pb.collection("businesses").getList(1, 1, {
        filter: `user = '${userId}'`,
      });
      if (res.items[0]) setVault(res.items[0] as unknown as VaultData);
    } catch { /* no record yet */ }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const userId = pb.authStore.record?.id;
      const data = {
        user: userId,
        business_name: vault.business_name ?? "",
        industry: vault.industry ?? "",
        description: vault.description ?? "",
        target_audience: vault.target_audience ?? "",
        website: vault.website ?? "",
      };
      if (vault.id) {
        await pb.collection("businesses").update(vault.id, data);
      } else {
        const rec = await pb.collection("businesses").create(data);
        setVault((v) => ({ ...v, id: rec.id }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof VaultData) {
    return (vault[key] as string) ?? "";
  }

  function set(key: keyof VaultData, value: string) {
    setVault((v) => ({ ...v, [key]: value }));
  }

  const coreFields = ["business_name", "industry", "description", "target_audience"] as const;
  const filledCount = coreFields.filter((k) => !!(vault[k] as string)?.trim()).length;
  const pct = Math.round((filledCount / coreFields.length) * 100);

  return (
    <main className="min-h-screen flex flex-col relative" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-8">

        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm" style={{ color: "#5A5A70" }}>← Dashboard</a>
        </header>

        {/* Title + completion ring */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8" }}>Your Vault</h1>
            <p className="text-sm" style={{ color: "#9090A8" }}>
              Everything your AI team knows about your business. The more you fill in, the better their work.
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 ml-6 flex-shrink-0">
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="22" fill="none" stroke="#1A1A24" strokeWidth="4" />
                <circle
                  cx="28" cy="28" r="22" fill="none"
                  stroke="#5B21E8" strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 22}`}
                  strokeDashoffset={`${2 * Math.PI * 22 * (1 - pct / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.5s ease" }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: "#F0F0F8" }}>
                {pct}%
              </span>
            </div>
            <span className="text-xs" style={{ color: "#5A5A70" }}>complete</span>
          </div>
        </div>

        {/* Business profile form */}
        <form onSubmit={handleSave}>
          <section className="rounded-2xl p-6 mb-4" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <h2 className="text-sm font-semibold mb-5" style={{ color: "#F0F0F8" }}>About Your Business</h2>
            <div className="flex flex-col gap-4">
              <Field label="Business name" placeholder="e.g., Acme Marketing, Blue Ridge Plumbing" value={field("business_name")} onChange={(v) => set("business_name", v)} />
              <Field label="Industry / What you do" placeholder="e.g., Digital marketing agency, Plumbing contractor, Online boutique" value={field("industry")} onChange={(v) => set("industry", v)} />
              <Field
                label="Describe your business"
                placeholder="In 1–2 sentences — what you do, who for, and what makes it work"
                value={field("description")}
                onChange={(v) => set("description", v)}
                multiline
              />
              <Field label="Who are your customers?" placeholder="e.g., Small business owners in the US, homeowners aged 35–55, e-commerce brands under $5M" value={field("target_audience")} onChange={(v) => set("target_audience", v)} />
              <Field label="Website" placeholder="yourbusiness.com" value={field("website")} onChange={(v) => set("website", v)} type="url" />
            </div>
          </section>

          {error && <p className="text-sm mb-4" style={{ color: "#EF4444" }}>{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="btn-primary w-full py-3 rounded-xl font-semibold text-white text-sm mb-8"
            style={{ opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Vault"}
          </button>
        </form>

        {/* Strategy snapshot (read-only from onboarding) */}
        {(vault.focus || vault.situation || vault.superpower) && (
          <section className="rounded-2xl p-6" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Strategy Snapshot</h2>
              <a href="/onboarding" className="text-xs" style={{ color: "#5B21E8" }}>Retake →</a>
            </div>
            <div className="flex flex-col gap-3">
              {vault.focus && (
                <SnapshotRow label="Primary focus" value={FOCUS_LABELS[vault.focus] ?? vault.focus} />
              )}
              {vault.situation && (
                <SnapshotRow label="Current situation" value={SITUATION_LABELS[vault.situation] ?? vault.situation} />
              )}
              {vault.superpower && (
                <SnapshotRow label="Competitive edge" value={SUPERPOWER_LABELS[vault.superpower] ?? vault.superpower} />
              )}
              {vault.bottlenecks && vault.bottlenecks.length > 0 && (
                <SnapshotRow
                  label="Key bottlenecks"
                  value={vault.bottlenecks.map((b) => BOTTLENECK_LABELS[b] ?? b).join(", ")}
                />
              )}
              {vault.magic_wand && (
                <SnapshotRow label="Top priority task" value={vault.magic_wand} />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Field({ label, placeholder, value, onChange, multiline, type }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  type?: string;
}) {
  const shared = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    className: "w-full px-4 py-3 rounded-xl text-sm outline-none transition-all",
    style: { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" } as React.CSSProperties,
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: "#9090A8" }}>{label}</label>
      {multiline
        ? <textarea {...shared} rows={3} style={{ ...shared.style, resize: "none", lineHeight: "1.6" }} />
        : <input {...shared} type={type ?? "text"} />
      }
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="flex-shrink-0 w-32 text-xs pt-0.5" style={{ color: "#5A5A70" }}>{label}</span>
      <span style={{ color: "#F0F0F8" }}>{value}</span>
    </div>
  );
}
