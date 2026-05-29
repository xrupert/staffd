"use client";

import { useState } from "react";
import pb from "../../lib/pb";

const CHOOSABLE_DEPARTMENTS = [
  { id: "hr",         icon: "👥", label: "HR",         tagline: "Hiring, onboarding & performance" },
  { id: "finance",    icon: "💰", label: "Finance",    tagline: "Invoices, budgets & projections" },
  { id: "operations", icon: "⚙️", label: "Operations", tagline: "SOPs, workflows & systems" },
  { id: "paid-media", icon: "📈", label: "Paid Media", tagline: "Google, Meta & ad strategy" },
  { id: "design",     icon: "🎨", label: "Design",     tagline: "Brand, visuals & UI direction" },
  { id: "reputation", icon: "🛡️", label: "Reputation", tagline: "Support, reviews & community" },
];

const PLAN_LIMITS: Record<string, number> = {
  growth: 1,
  pro:    3,
};

interface DepartmentPickerProps {
  plan: string;
  onComplete: (chosen: string[]) => void;
}

export default function DepartmentPicker({ plan, onComplete }: DepartmentPickerProps) {
  const limit = PLAN_LIMITS[plan] ?? 1;
  const isPro = plan === "pro";

  // CEO is never user-choosable: Pro/Agency get it included, Starter/Growth don't get it
  const available = CHOOSABLE_DEPARTMENTS;

  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= limit) return prev; // at limit
      return [...prev, id];
    });
  }

  async function handleSave() {
    if (selected.length !== limit) return;
    setSaving(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      await fetch("/api/departments/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, departments: selected }),
      });
      onComplete(selected);
    } catch {
      setSaving(false);
    }
  }

  const planLabel = plan === "growth" ? "Growth" : "Pro";
  const autoLabel = isPro ? "Marketing, Sales, Legal & The CEO are included." : "Marketing, Sales & Legal are always included.";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.9)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}
      >
        {/* Header */}
        <div className="px-8 py-7" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>
            {planLabel} Plan — Choose Your Department{limit > 1 ? "s" : ""}
          </p>
          <h2 className="text-xl font-bold mb-2" style={{ color: "#F0F0F8", letterSpacing: "-0.02em" }}>
            Which department do you want to unlock{limit > 1 ? ` first` : ""}?
          </h2>
          <p className="text-sm" style={{ color: "#5A5A70" }}>
            {autoLabel}{" "}
            {limit > 1
              ? `Pick ${limit} more departments to complete your team.`
              : "Pick 1 more to complete your starter team."}
          </p>
        </div>

        {/* Department grid */}
        <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {available.map((dept) => {
            const isSelected = selected.includes(dept.id);
            const isDisabled = !isSelected && selected.length >= limit;
            return (
              <button
                key={dept.id}
                onClick={() => !isDisabled && toggle(dept.id)}
                disabled={isDisabled}
                className="rounded-xl p-4 text-left flex flex-col gap-2 transition-all"
                style={{
                  background: isSelected ? "rgba(91,33,232,0.15)" : "#111118",
                  border: isSelected ? "1px solid #5B21E8" : "1px solid #2A2A38",
                  opacity: isDisabled ? 0.4 : 1,
                  cursor: isDisabled ? "not-allowed" : "pointer",
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

        {/* Footer */}
        <div className="px-8 pb-7 flex items-center justify-between">
          <p className="text-xs" style={{ color: "#3A3A50" }}>
            {selected.length}/{limit} selected
            {isPro && " · CEO is auto-included"}
          </p>
          <button
            onClick={() => void handleSave()}
            disabled={selected.length !== limit || saving}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{
              background: selected.length === limit ? "#5B21E8" : "rgba(91,33,232,0.2)",
              opacity: selected.length === limit && !saving ? 1 : 0.5,
              cursor: selected.length === limit && !saving ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : `Unlock my department${limit > 1 ? "s" : ""} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
