"use client";

import { useState } from "react";
import pb from "../../lib/pb";

const ALL_ADDABLE = [
  { id: "hr",         icon: "👥", label: "HR",         tagline: "Hiring, onboarding & performance" },
  { id: "finance",    icon: "💰", label: "Finance",    tagline: "Invoices, budgets & projections" },
  { id: "operations", icon: "⚙️", label: "Operations", tagline: "SOPs, workflows & systems" },
  { id: "paid-media", icon: "📈", label: "Paid Media", tagline: "Google, Meta & ad strategy" },
  { id: "design",     icon: "🎨", label: "Design",     tagline: "Brand, visuals & UI direction" },
  { id: "reputation", icon: "🛡️", label: "Reputation", tagline: "Support, reviews & community" },
];

interface AddDeptModalProps {
  alreadyUnlocked: string[];
  onClose: () => void;
}

export default function AddDeptModal({ alreadyUnlocked, onClose }: AddDeptModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const available = ALL_ADDABLE.filter((d) => !alreadyUnlocked.includes(d.id));

  async function handleAdd() {
    if (!selected || loading) return;
    setLoading(true);
    try {
      const userId    = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string) ?? "";
      const res = await fetch("/api/stripe/checkout-addon", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ userId, userEmail, department: selected }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Addon checkout error:", data.error);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 py-7 flex items-start justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>
              Add a Department
            </p>
            <h2 className="text-xl font-bold mb-1" style={{ color: "#F0F0F8", letterSpacing: "-0.02em" }}>
              Bring another team online — $29/mo
            </h2>
            <p className="text-sm" style={{ color: "#5A5A70" }}>
              Adds an extra full department of specialists to your plan. Cancel any time.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "20px", marginLeft: "16px" }}
          >
            ×
          </button>
        </div>

        {/* Empty state — nothing left to add */}
        {available.length === 0 && (
          <div className="px-8 py-10 text-center">
            <p className="text-sm mb-1" style={{ color: "#F0F0F8", fontWeight: 600 }}>You already have every department unlocked. 🎉</p>
            <p className="text-xs" style={{ color: "#5A5A70" }}>Looks like you&apos;re fully staffed.</p>
          </div>
        )}

        {/* Dept grid */}
        {available.length > 0 && (
          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {available.map((dept) => {
              const isSelected = selected === dept.id;
              return (
                <button
                  key={dept.id}
                  onClick={() => setSelected(dept.id)}
                  className="rounded-xl p-4 text-left flex flex-col gap-2 transition-all"
                  style={{
                    background: isSelected ? "rgba(91,33,232,0.15)" : "#111118",
                    border: isSelected ? "1px solid #5B21E8" : "1px solid #2A2A38",
                    cursor: "pointer",
                    boxShadow: isSelected ? "0 0 20px rgba(91,33,232,0.1)" : "none",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl">{dept.icon}</span>
                    {isSelected && (
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: "#5B21E8", fontSize: "10px", color: "#fff" }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{dept.label}</p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: "#5A5A70" }}>{dept.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Footer */}
        {available.length > 0 && (
          <div className="px-8 pb-7 flex items-center justify-between">
            <p className="text-xs" style={{ color: "#3A3A50" }}>
              $29/mo per added department · Cancel any time
            </p>
            <button
              onClick={() => void handleAdd()}
              disabled={!selected || loading}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{
                background: selected ? "#5B21E8" : "rgba(91,33,232,0.2)",
                opacity: selected && !loading ? 1 : 0.5,
                cursor: selected && !loading ? "pointer" : "not-allowed",
              }}
            >
              {loading ? "Opening checkout…" : "Continue to checkout →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
