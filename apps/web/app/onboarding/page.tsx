"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import pb from "../../lib/pb";

const TOTAL_STEPS = 6;

// Step 1 — Primary focus
const FOCUS_OPTIONS = [
  { id: "growth", icon: "🚀", label: "Top-Line Growth", desc: "Finding leads, closing deals, and driving revenue." },
  { id: "time", icon: "⏳", label: "Time Recovery", desc: "Automating repetitive tasks and fixing broken workflows." },
  { id: "cx", icon: "👥", label: "Customer Experience", desc: "Retention, faster support, and client satisfaction." },
  { id: "intelligence", icon: "📊", label: "Intelligence & Scaling", desc: "Data analysis, market research, and strategic planning." },
];

// Step 2 — Bottlenecks
const BOTTLENECK_OPTIONS = [
  { id: "content", label: "Content Creation & Marketing" },
  { id: "leads", label: "Lead Generation & Outbound Sales" },
  { id: "support", label: "Customer Support & Account Management" },
  { id: "ops", label: "Data Entry, Invoicing & Ops Admin" },
  { id: "research", label: "Market Research & Competitor Analysis" },
];

// Step 3 — Situation
const SITUATION_OPTIONS = [
  { id: "solo", icon: "🧍", label: "I do everything myself — I'm running out of hours", desc: "You're the whole team. Time is the constraint." },
  { id: "skills", icon: "👥", label: "I have a small team but we're missing key skills", desc: "The people are there, but the expertise isn't." },
  { id: "scaling", icon: "📈", label: "We're growing faster than we can hire", desc: "Demand is outpacing your team's capacity." },
  { id: "cost", icon: "💸", label: "I need expert-level work without the expert-level cost", desc: "Quality matters but the budget has limits." },
  { id: "chaos", icon: "🔄", label: "Our processes are broken — things keep slipping through the cracks", desc: "The work exists but nothing runs smoothly." },
  { id: "starting", icon: "🌱", label: "I'm just starting out and need to build everything right", desc: "Blank slate. You want to do it properly from day one." },
];

// Step 4 — Superpower
const SUPERPOWER_OPTIONS = [
  { id: "speed", icon: "⚡", label: "Speed & Efficiency", desc: "We get things done faster than anyone else." },
  { id: "quality", icon: "💎", label: "Premium Quality / Expertise", desc: "We provide high-end, bespoke solutions." },
  { id: "value", icon: "💰", label: "Cost-Effectiveness", desc: "We offer the best value for their budget." },
  { id: "relationships", icon: "❤️", label: "Deep Relationships", desc: "Our customer service and personal touch are unmatched." },
];

// Agent matching logic
function computeRecommended(focus: string, bottlenecks: string[]): string[] {
  const scores: { [key: string]: number } = {
    Marketing: 0, Sales: 0, Legal: 0, HR: 0, Finance: 0, Operations: 0,
  };
  const add = (k: string, v: number) => { scores[k] = (scores[k] ?? 0) + v; };
  if (focus === "growth") { add("Marketing", 2); add("Sales", 2); }
  if (focus === "time") { add("Operations", 3); }
  if (focus === "cx") { add("HR", 2); add("Sales", 1); }
  if (focus === "intelligence") { add("Operations", 2); add("Finance", 2); }
  if (bottlenecks.includes("content")) add("Marketing", 2);
  if (bottlenecks.includes("leads")) add("Sales", 2);
  if (bottlenecks.includes("support")) add("HR", 2);
  if (bottlenecks.includes("ops")) add("Operations", 2);
  if (bottlenecks.includes("research")) { add("Marketing", 1); add("Finance", 1); }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter(([, s]) => s > 0)
    .slice(0, 2)
    .map(([name]) => name);
}

interface PrefillData {
  business_name?: string;
  industry?: string;
  description?: string;
  target_audience?: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1 — website auto-fill
  const [website, setWebsite] = useState("");
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillError, setPrefillError] = useState("");
  const [prefillData, setPrefillData] = useState<PrefillData | null>(null);

  // Steps 2–6
  const [focus, setFocus] = useState("");
  const [bottlenecks, setBottlenecks] = useState<string[]>([]);
  const [situation, setSituation] = useState("");
  const [superpower, setSuperpower] = useState("");
  const [magicWand, setMagicWand] = useState("");
  const [recommended, setRecommended] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function fetchFromWebsite() {
    if (!website.trim()) return;
    setPrefillLoading(true);
    setPrefillError("");
    try {
      const url = website.trim().startsWith("http") ? website.trim() : `https://${website.trim()}`;
      const res = await fetch("/api/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as PrefillData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      setPrefillData(data);
    } catch (err) {
      setPrefillError(err instanceof Error ? err.message : "Could not pull info. You can fill in manually later.");
    } finally {
      setPrefillLoading(false);
    }
  }

  function toggleBottleneck(id: string) {
    setBottlenecks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : prev
    );
  }

  function canAdvance() {
    if (step === 1) return true; // website step is optional
    if (step === 2) return !!focus;
    if (step === 3) return bottlenecks.length > 0;
    if (step === 4) return !!situation;
    if (step === 5) return !!superpower;
    return true;
  }

  async function handleFinish() {
    setSaving(true);
    const rec = computeRecommended(focus, bottlenecks);
    setRecommended(rec);
    try {
      const userId = pb.authStore.record?.id;
      if (userId) {
        const normalizedUrl = website.trim()
          ? website.trim().startsWith("http") ? website.trim() : `https://${website.trim()}`
          : "";

        const payload = {
          user: userId,
          focus,
          bottlenecks,
          situation,
          superpower,
          magic_wand: magicWand,
          recommended_departments: rec,
          website: normalizedUrl,
          business_name: prefillData?.business_name ?? "",
          industry: prefillData?.industry ?? "",
          description: prefillData?.description ?? "",
          target_audience: prefillData?.target_audience ?? "",
        };

        // Guard: check for existing record and update instead of creating a duplicate
        const existing = await pb.collection("businesses").getList(1, 1, {
          filter: `user = '${userId}'`,
        });

        if (existing.items.length > 0 && existing.items[0]) {
          await pb.collection("businesses").update(existing.items[0].id, payload);
        } else {
          await pb.collection("businesses").create(payload);
        }
      }
    } catch {
      // non-blocking — proceed regardless
    } finally {
      setSaving(false);
      setStep(7);
    }
  }

  if (step === 7) {
    return <ResultsScreen recommended={recommended} onContinue={() => router.push("/dashboard")} />;
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

      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-8 flex flex-col flex-1">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium" style={{ color: "#5A5A70" }}>
              Step {step} of {TOTAL_STEPS}
            </span>
            <span className="text-xs" style={{ color: "#5A5A70" }}>
              {Math.round((step / TOTAL_STEPS) * 100)}%
            </span>
          </div>
          <div className="w-full h-1 rounded-full" style={{ background: "#1A1A24" }}>
            <div
              className="h-1 rounded-full transition-all duration-500"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: "#5B21E8" }}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1">
          {step === 1 && (
            <Step
              title="Let's start with your website"
              subtitle="Enter your URL and we'll pull your business details automatically. You can edit anything — or skip and fill it in later."
            >
              <div className="flex flex-col gap-4">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={website}
                    onChange={(e) => { setWebsite(e.target.value); setPrefillData(null); setPrefillError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && website.trim()) void fetchFromWebsite(); }}
                    placeholder="yourbusiness.com"
                    className="flex-1 px-4 py-3 rounded-xl text-sm outline-none"
                    style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
                  />
                  <button
                    onClick={() => void fetchFromWebsite()}
                    disabled={!website.trim() || prefillLoading}
                    className="btn-primary px-4 py-3 rounded-xl text-sm font-semibold text-white flex-shrink-0"
                    style={{ opacity: !website.trim() || prefillLoading ? 0.4 : 1, cursor: !website.trim() || prefillLoading ? "not-allowed" : "pointer" }}
                  >
                    {prefillLoading ? "Pulling…" : "Pull info →"}
                  </button>
                </div>

                {prefillError && (
                  <div className="px-4 py-3 rounded-xl text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
                    {prefillError}
                  </div>
                )}

                {prefillData && (
                  <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.35)" }}>
                    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5B21E8" }}>Pulled from your website — edit anything</p>
                    <OnboardingField
                      label="Business name"
                      value={prefillData.business_name ?? ""}
                      onChange={(v) => setPrefillData((d) => d ? { ...d, business_name: v } : d)}
                    />
                    <OnboardingField
                      label="Industry / What you do"
                      value={prefillData.industry ?? ""}
                      onChange={(v) => setPrefillData((d) => d ? { ...d, industry: v } : d)}
                    />
                    <OnboardingField
                      label="Description"
                      value={prefillData.description ?? ""}
                      onChange={(v) => setPrefillData((d) => d ? { ...d, description: v } : d)}
                      multiline
                    />
                    <OnboardingField
                      label="Target customers"
                      value={prefillData.target_audience ?? ""}
                      onChange={(v) => setPrefillData((d) => d ? { ...d, target_audience: v } : d)}
                    />
                  </div>
                )}

                {!prefillData && !prefillLoading && (
                  <p className="text-xs text-center" style={{ color: "#3A3A50" }}>
                    No website yet? Hit Continue — you can add business details in the Vault later.
                  </p>
                )}
              </div>
            </Step>
          )}

          {step === 2 && (
            <Step
              title="What is your primary focus right now?"
              subtitle="Choose the outcome you want to achieve first."
            >
              <div className="grid grid-cols-1 gap-3">
                {FOCUS_OPTIONS.map((opt) => (
                  <OptionCard
                    key={opt.id}
                    icon={opt.icon}
                    label={opt.label}
                    desc={opt.desc}
                    selected={focus === opt.id}
                    onClick={() => setFocus(opt.id)}
                  />
                ))}
              </div>
            </Step>
          )}

          {step === 3 && (
            <Step
              title="Where is your business most starved for time?"
              subtitle="Select up to 2 areas where you need the most help."
            >
              <div className="flex flex-col gap-3">
                {BOTTLENECK_OPTIONS.map((opt) => (
                  <SelectableRow
                    key={opt.id}
                    label={opt.label}
                    selected={bottlenecks.includes(opt.id)}
                    disabled={bottlenecks.length >= 2 && !bottlenecks.includes(opt.id)}
                    onClick={() => toggleBottleneck(opt.id)}
                  />
                ))}
              </div>
            </Step>
          )}

          {step === 4 && (
            <Step
              title="What best describes why you need your AI team?"
              subtitle="Choose the one that hits closest."
            >
              <div className="grid grid-cols-1 gap-3">
                {SITUATION_OPTIONS.map((opt) => (
                  <OptionCard
                    key={opt.id}
                    icon={opt.icon}
                    label={opt.label}
                    desc={opt.desc}
                    selected={situation === opt.id}
                    onClick={() => setSituation(opt.id)}
                  />
                ))}
              </div>
            </Step>
          )}

          {step === 5 && (
            <Step
              title="Why do your best customers choose you?"
              subtitle="This shapes how your AI team communicates and strategizes."
            >
              <div className="grid grid-cols-1 gap-3">
                {SUPERPOWER_OPTIONS.map((opt) => (
                  <OptionCard
                    key={opt.id}
                    icon={opt.icon}
                    label={opt.label}
                    desc={opt.desc}
                    selected={superpower === opt.id}
                    onClick={() => setSuperpower(opt.id)}
                  />
                ))}
              </div>
            </Step>
          )}

          {step === 6 && (
            <Step
              title="If AI could take one task off your plate by tomorrow, what would it be?"
              subtitle="Optional — but the more specific, the better."
            >
              <textarea
                value={magicWand}
                onChange={(e) => setMagicWand(e.target.value)}
                placeholder="e.g., Filtering through junk leads in my inbox every morning"
                rows={4}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none transition-all"
                style={{
                  background: "#111118",
                  border: "1px solid #2A2A38",
                  color: "#F0F0F8",
                  lineHeight: "1.6",
                }}
              />
            </Step>
          )}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between pt-6 mt-6" style={{ borderTop: "1px solid #1A1A28" }}>
          {step > 1 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="text-sm"
              style={{ color: "#5A5A70" }}
            >
              ← Back
            </button>
          ) : <div />}

          {step < TOTAL_STEPS ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="btn-primary px-6 py-2.5 rounded-xl font-semibold text-white text-sm"
              style={{ opacity: canAdvance() ? 1 : 0.4, cursor: canAdvance() ? "pointer" : "not-allowed" }}
            >
              {step === 1 && prefillData ? "Looks right →" : "Continue →"}
            </button>
          ) : (
            <button
              onClick={() => void handleFinish()}
              disabled={saving}
              className="btn-primary px-6 py-2.5 rounded-xl font-semibold text-white text-sm"
              style={{ opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Setting up your team…" : "Build my AI team →"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OnboardingField({ label, value, onChange, multiline }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
  const s: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" };
  const c = "w-full px-4 py-3 rounded-xl text-sm outline-none";
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={`${c} resize-none`} style={{ ...s, lineHeight: "1.6" }} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={c} style={s} />
      )}
    </div>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "#F0F0F8" }}>{title}</h1>
      <p className="text-sm mb-6" style={{ color: "#9090A8" }}>{subtitle}</p>
      {children}
    </div>
  );
}

function OptionCard({ icon, label, desc, selected, onClick }: {
  icon: string; label: string; desc: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-5 py-4 rounded-xl flex items-start gap-4 transition-all"
      style={{
        background: selected ? "rgba(91,33,232,0.12)" : "#111118",
        border: selected ? "1px solid #5B21E8" : "1px solid #2A2A38",
      }}
    >
      <span className="text-2xl mt-0.5">{icon}</span>
      <div>
        <p className="font-semibold text-sm" style={{ color: "#F0F0F8" }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>{desc}</p>
      </div>
    </button>
  );
}

function SelectableRow({ label, selected, disabled, onClick }: {
  label: string; selected: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-5 py-3.5 rounded-xl flex items-center gap-3 transition-all"
      style={{
        background: selected ? "rgba(91,33,232,0.12)" : "#111118",
        border: selected ? "1px solid #5B21E8" : "1px solid #2A2A38",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <div
        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
        style={{
          background: selected ? "#5B21E8" : "transparent",
          border: selected ? "1px solid #5B21E8" : "1px solid #3A3A50",
        }}
      >
        {selected && <span style={{ color: "#fff", fontSize: "10px" }}>✓</span>}
      </div>
      <span className="text-sm" style={{ color: "#F0F0F8" }}>{label}</span>
    </button>
  );
}


function ResultsScreen({ recommended, onContinue }: { recommended: string[]; onContinue: () => void }) {
  const DEPT_DESC: Record<string, string> = {
    Marketing: "Content, SEO, ads & social media — ready to create and distribute.",
    Sales: "Outreach, follow-ups & pipeline management — ready to find and close deals.",
    Legal: "Contracts, policies & compliance — ready to review and protect you.",
    HR: "Hiring, onboarding & culture — ready to build and support your team.",
    Finance: "Budgets, forecasting & reporting — ready to track and grow your numbers.",
    Operations: "Workflows, SOPs & automation — ready to eliminate your busywork.",
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center relative px-6" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      <div
        className="fixed pointer-events-none"
        style={{
          top: "50%", left: "50%", transform: "translate(-50%,-55%)",
          width: "600px", height: "600px", borderRadius: "50%",
          background: "radial-gradient(circle,rgba(91,33,232,0.12) 0%,transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-lg text-center">
        <div className="text-4xl mb-4">✅</div>
        <h1 className="text-3xl font-bold mb-3" style={{ color: "#F0F0F8" }}>
          Your AI team is ready.
        </h1>
        <p className="text-base mb-10" style={{ color: "#9090A8" }}>
          Based on your answers, we&apos;ve provisioned{" "}
          <span style={{ color: "#F0F0F8", fontWeight: 600 }}>
            {recommended.length > 0 ? recommended.join(" and ") : "your first departments"}
          </span>{" "}
          to start working for you immediately.
        </p>

        <div className="flex flex-col gap-3 mb-10 text-left">
          {recommended.map((dept) => (
            <div
              key={dept}
              className="rounded-2xl px-6 py-4 flex items-start gap-4"
              style={{ background: "#111118", border: "1px solid #5B21E8" }}
            >
              <div
                className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                style={{ background: "#5B21E8", boxShadow: "0 0 8px rgba(91,33,232,0.6)" }}
              />
              <div>
                <p className="font-semibold text-sm mb-0.5" style={{ color: "#F0F0F8" }}>{dept}</p>
                <p className="text-xs" style={{ color: "#5A5A70" }}>{DEPT_DESC[dept]}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onContinue}
          className="btn-primary w-full py-4 rounded-xl font-semibold text-white text-base"
        >
          Let&apos;s go →
        </button>
      </div>
    </main>
  );
}
