"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
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
  collectionId?: string;
  business_name?: string;
  industry?: string;
  description?: string;
  target_audience?: string;
  website?: string;
  phone?: string;
  primary_email?: string;
  address?: string;
  secondary_email?: string;
  other_email?: string;
  logo?: string;
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
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    void loadVault();
  }, []);

  async function loadVault() {
    try {
      const userId = pb.authStore.record?.id;
      const res = await pb.collection("businesses").getList(1, 1, { filter: `user = '${userId}'` });
      const rec = res.items[0];
      if (rec) {
        setVault(rec as unknown as VaultData);
        if (rec.logo && rec.id && rec.collectionId) {
          const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";
          setLogoPreview(`${pbUrl}/api/files/${rec.collectionId as string}/${rec.id as string}/${rec.logo as string}`);
        }
      }
    } catch { /* no record yet */ }
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const userId = pb.authStore.record?.id;

      const formData = new FormData();
      formData.append("user", userId ?? "");
      formData.append("business_name", vault.business_name ?? "");
      formData.append("industry", vault.industry ?? "");
      formData.append("description", vault.description ?? "");
      formData.append("target_audience", vault.target_audience ?? "");
      formData.append("website", vault.website ?? "");
      formData.append("phone", vault.phone ?? "");
      formData.append("primary_email", vault.primary_email ?? "");
      formData.append("address", vault.address ?? "");
      formData.append("secondary_email", vault.secondary_email ?? "");
      formData.append("other_email", vault.other_email ?? "");
      if (logoFile) formData.append("logo", logoFile);

      let rec: VaultData;
      if (vault.id) {
        rec = await pb.collection("businesses").update(vault.id, formData) as unknown as VaultData;
      } else {
        rec = await pb.collection("businesses").create(formData) as unknown as VaultData;
        setVault((v) => ({ ...v, id: rec.id, collectionId: rec.collectionId }));
      }
      setLogoFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof VaultData) { return (vault[key] as string) ?? ""; }
  function set(key: keyof VaultData, value: string) { setVault((v) => ({ ...v, [key]: value })); }

  const coreFields = ["business_name", "industry", "description", "target_audience"] as const;
  const filledCount = coreFields.filter((k) => !!(vault[k] as string)?.trim()).length;
  const pct = Math.round((filledCount / coreFields.length) * 100);
  const circumference = 2 * Math.PI * 22;

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

        <div className="flex items-start justify-between mb-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Business Vault</p>
            <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "2rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Your Business Profile</h1>
            <p className="text-sm" style={{ color: "#9090A8" }}>Everything your AI team knows about your business.</p>
          </div>
          <div className="flex flex-col items-center gap-1.5 ml-6 flex-shrink-0">
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="22" fill="none" stroke="#1A1A24" strokeWidth="3.5" />
                <circle cx="28" cy="28" r="22" fill="none" stroke="#5B21E8" strokeWidth="3.5"
                  strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct / 100)}
                  strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: "#F0F0F8" }}>{pct}%</span>
            </div>
            <span className="text-xs" style={{ color: "#5A5A70" }}>complete</span>
          </div>
        </div>

        <form onSubmit={(e) => void handleSave(e)}>

          {/* Business info */}
          <div className="rounded-2xl p-7 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "#5A5A70" }}>About Your Business</p>
            <div className="flex flex-col gap-5">
              <VaultField label="Business name" placeholder="e.g., Acme Marketing, Blue Ridge Plumbing" value={field("business_name")} onChange={(v) => set("business_name", v)} />
              <VaultField label="Industry / What you do" placeholder="e.g., Digital marketing agency, Plumbing contractor" value={field("industry")} onChange={(v) => set("industry", v)} />
              <VaultField label="Business description" placeholder="In 1–2 sentences — what you do, who for, and what makes it work" value={field("description")} onChange={(v) => set("description", v)} multiline />
              <VaultField label="Target customers" placeholder="e.g., Small business owners in the US, homeowners aged 35–55" value={field("target_audience")} onChange={(v) => set("target_audience", v)} />
              <VaultField label="Website" placeholder="yourbusiness.com" value={field("website")} onChange={(v) => set("website", v)} type="url" />
            </div>
          </div>

          {/* Contact details */}
          <div className="rounded-2xl p-7 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-6" style={{ color: "#5A5A70" }}>Contact Details</p>
            <p className="text-xs mb-5" style={{ color: "#3A3A50" }}>Used on invoices, contracts, and any document your AI team generates.</p>
            <div className="flex flex-col gap-5">
              <VaultField label="Phone number" placeholder="+1 (555) 000-0000" value={field("phone")} onChange={(v) => set("phone", v)} type="tel" />
              <VaultField label="Primary email" placeholder="hello@yourbusiness.com" value={field("primary_email")} onChange={(v) => set("primary_email", v)} type="email" />
              <VaultField label="Business address" placeholder="123 Main St, Suite 100, New York, NY 10001" value={field("address")} onChange={(v) => set("address", v)} multiline />
              <VaultField label="Secondary email" placeholder="billing@yourbusiness.com" value={field("secondary_email")} onChange={(v) => set("secondary_email", v)} type="email" />
              <VaultField label="Other email" placeholder="info@yourbusiness.com" value={field("other_email")} onChange={(v) => set("other_email", v)} type="email" />
            </div>
          </div>

          {/* Logo */}
          <div className="rounded-2xl p-7 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5A5A70" }}>Business Logo</p>
            <p className="text-xs mb-5" style={{ color: "#3A3A50" }}>Appears in the header of all PDF exports. PNG or JPG, max 2 MB.</p>

            <div className="flex items-center gap-5">
              {/* Logo preview */}
              <div
                className="w-20 h-20 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38" }}
              >
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview} alt="Logo" className="w-full h-full object-contain rounded-xl p-2" />
                ) : (
                  <span style={{ color: "#3A3A50", fontSize: "24px" }}>🏢</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                  style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#9090A8" }}
                >
                  {logoPreview ? "Change logo" : "Upload logo"}
                </button>
                {logoPreview && (
                  <button
                    type="button"
                    onClick={() => { setLogoPreview(""); setLogoFile(null); setVault((v) => ({ ...v, logo: "" })); }}
                    className="text-xs transition-colors hover:text-red-400"
                    style={{ color: "#3A3A50" }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                onChange={handleLogoSelect}
                style={{ display: "none" }}
              />
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-xs mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={saving} className="btn-primary w-full py-3.5 rounded-xl font-semibold text-white text-sm mb-8" style={{ opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Vault"}
          </button>
        </form>

        {/* Strategy snapshot */}
        {(vault.focus || vault.situation || vault.superpower) && (
          <div className="rounded-2xl p-7" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <div className="flex items-center justify-between mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5A5A70" }}>Strategy Snapshot</p>
              <a href="/onboarding" className="text-xs font-medium transition-colors hover:text-white" style={{ color: "#5B21E8" }}>Retake →</a>
            </div>
            <div className="flex flex-col gap-4">
              {vault.focus && <SnapshotRow label="Primary focus" value={FOCUS_LABELS[vault.focus] ?? vault.focus} />}
              {vault.situation && <SnapshotRow label="Situation" value={SITUATION_LABELS[vault.situation] ?? vault.situation} />}
              {vault.superpower && <SnapshotRow label="Competitive edge" value={SUPERPOWER_LABELS[vault.superpower] ?? vault.superpower} />}
              {vault.bottlenecks && vault.bottlenecks.length > 0 && (
                <SnapshotRow label="Bottlenecks" value={vault.bottlenecks.map((b) => BOTTLENECK_LABELS[b] ?? b).join(", ")} />
              )}
              {vault.magic_wand && <SnapshotRow label="Top priority" value={vault.magic_wand} />}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function VaultField({ label, placeholder, value, onChange, multiline, type }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; multiline?: boolean; type?: string;
}) {
  const s: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" };
  const c = "w-full px-4 py-3 rounded-xl text-sm outline-none transition-all";
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={c} style={{ ...s, resize: "none", lineHeight: "1.6" }} />
      ) : (
        <input type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={c} style={s} />
      )}
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="flex-shrink-0 text-xs pt-0.5" style={{ color: "#5A5A70", width: "120px" }}>{label}</span>
      <span style={{ color: "#C0C0D8" }}>{value}</span>
    </div>
  );
}
