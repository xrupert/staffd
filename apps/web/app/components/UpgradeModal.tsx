"use client";

import { useState } from "react";
import pb from "../../lib/pb";

interface Plan {
  id: string;
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  annualMonthly: string;
  annualSavings: string;
  tagline: string;
  features: string[];
  cta: string;
  highlight: boolean;
}

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: "$39",
    annualPrice: "$390",
    annualMonthly: "$32.50",
    annualSavings: "$78",
    tagline: "6 hand-picked specialists, on the clock the day you sign up.",
    features: [
      "6 hand-picked specialists",
      "Unlimited work from your staff",
      "Document library",
      "PDF & Word export",
      "Business Vault",
      "3 trial runs per locked department",
    ],
    cta: "Hire Starter staff",
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: "$79",
    annualPrice: "$790",
    annualMonthly: "$65.83",
    annualSavings: "$158",
    tagline: "Your starter staff plus one full department.",
    features: [
      "Everything in Starter",
      "1 full department (your choice)",
      "Every specialist in that department on call",
      "Content calendar",
      "Email campaign sending",
      "Add more departments at $29/mo each",
    ],
    cta: "Hire Growth staff",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: "$149",
    annualPrice: "$1,490",
    annualMonthly: "$124.17",
    annualSavings: "$298",
    tagline: "Three departments plus The CEO — your strategic advisor across every team.",
    features: [
      "Everything in Growth",
      "3 full departments (your choice)",
      "The CEO included",
      "E-signature sending",
      "CRM integration",
      "Weekly business briefings",
    ],
    cta: "Promote to Pro",
    highlight: true,
  },
  {
    id: "agency",
    name: "Agency",
    monthlyPrice: "$450",
    annualPrice: "$4,500",
    annualMonthly: "$375",
    annualSavings: "$900",
    tagline: "Your complete staff. Every department.",
    features: [
      "All 9 departments fully staffed",
      "The CEO included",
      "Multi-client dashboard",
      "White-label ready",
      "Priority support",
      "All integrations",
    ],
    cta: "Promote to Agency",
    highlight: false,
  },
];

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", ceo: "Strategy",
  "paid-media": "Paid Media", design: "Design", reputation: "Reputation",
};

interface UpgradeModalProps {
  department: string;
  currentPlan?: string;
  onClose: () => void;
}

export default function UpgradeModal({ department, currentPlan = "starter", onClose }: UpgradeModalProps) {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const deptLabel = DEPT_LABELS[department] ?? department;

  async function handleCheckout(planId: string) {
    if (checkingOut) return;
    setCheckingOut(planId);
    try {
      const userId    = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string) ?? "";
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, interval, userId, userEmail }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Checkout error:", data.error);
        setCheckingOut(null);
      }
    } catch {
      setCheckingOut(null);
    }
  }

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
    } catch { /* ignore */ } finally {
      setPortalLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl overflow-hidden"
        style={{ background: "#0D0D14", border: "1px solid #2A2A38", maxHeight: "92vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div className="px-8 py-6 flex items-start justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#5B21E8" }}>
              Upgrade Required
            </p>
            <h2 className="font-bold text-xl" style={{ color: "#F0F0F8", letterSpacing: "-0.02em" }}>
              Unlock the {deptLabel} Department
            </h2>
            <p className="text-sm mt-1" style={{ color: "#5A5A70" }}>
              You&apos;ve used your 3 free trial runs. Choose a plan to keep going.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "20px", marginLeft: "16px", marginTop: "-4px" }}
          >
            ×
          </button>
        </div>

        {/* Billing interval toggle */}
        <div className="flex justify-center pt-6 pb-2">
          <div
            className="flex items-center gap-1 p-1 rounded-xl"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <button
              onClick={() => setInterval("monthly")}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: interval === "monthly" ? "#1E1E2E" : "transparent",
                color: interval === "monthly" ? "#F0F0F8" : "#5A5A70",
                border: interval === "monthly" ? "1px solid #2A2A38" : "1px solid transparent",
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval("annual")}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: interval === "annual" ? "#1E1E2E" : "transparent",
                color: interval === "annual" ? "#F0F0F8" : "#5A5A70",
                border: interval === "annual" ? "1px solid #2A2A38" : "1px solid transparent",
              }}
            >
              Annual
              <span
                className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                style={{ background: "rgba(91,33,232,0.25)", color: "#A07BFF", fontSize: "9px" }}
              >
                2 months free
              </span>
            </button>
          </div>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-6">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlan;
            const isLoading = checkingOut === plan.id;

            return (
              <div
                key={plan.id}
                className="rounded-xl p-5 flex flex-col"
                style={{
                  background: plan.highlight ? "rgba(91,33,232,0.1)" : "#111118",
                  border: plan.highlight ? "1px solid rgba(91,33,232,0.5)" : "1px solid #2A2A38",
                  boxShadow: plan.highlight ? "0 0 30px rgba(91,33,232,0.12)" : "none",
                  position: "relative",
                }}
              >
                {plan.highlight && (
                  <div
                    className="absolute -top-3 left-1/2 text-xs font-bold px-3 py-1 rounded-full"
                    style={{
                      transform: "translateX(-50%)",
                      background: "#5B21E8",
                      color: "#fff",
                      fontSize: "10px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Most Popular
                  </div>
                )}

                <div className="mb-4">
                  <p className="text-sm font-bold mb-1" style={{ color: "#F0F0F8" }}>{plan.name}</p>

                  {interval === "monthly" ? (
                    <div className="flex items-baseline gap-0.5 mb-1">
                      <span className="text-2xl font-bold" style={{ color: "#F0F0F8" }}>{plan.monthlyPrice}</span>
                      <span className="text-xs" style={{ color: "#5A5A70" }}>/mo</span>
                    </div>
                  ) : (
                    <div className="mb-1">
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-2xl font-bold" style={{ color: "#F0F0F8" }}>{plan.annualPrice}</span>
                        <span className="text-xs" style={{ color: "#5A5A70" }}>/yr</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs" style={{ color: "#6060A0" }}>{plan.annualMonthly}/mo</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
                          style={{ background: "rgba(34,197,94,0.1)", color: "#22C55E", fontSize: "9px" }}
                        >
                          save {plan.annualSavings}
                        </span>
                      </div>
                    </div>
                  )}

                  <p className="text-xs leading-snug" style={{ color: "#6060A0" }}>{plan.tagline}</p>
                </div>

                <ul className="flex flex-col gap-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-xs" style={{ color: "#9090A8" }}>
                      <span style={{ color: "#5B21E8", flexShrink: 0, marginTop: "1px" }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div
                    className="text-center py-2.5 rounded-xl text-xs font-semibold"
                    style={{ background: "#1A1A24", color: "#3A3A55", border: "1px solid #2A2A38" }}
                  >
                    Current plan
                  </div>
                ) : (
                  <button
                    onClick={() => void handleCheckout(plan.id)}
                    disabled={!!checkingOut}
                    className="text-center py-2.5 rounded-xl text-xs font-semibold transition-all w-full"
                    style={{
                      background: isLoading
                        ? "rgba(91,33,232,0.08)"
                        : plan.highlight ? "#5B21E8" : "rgba(91,33,232,0.15)",
                      color: plan.highlight ? "#fff" : "#A07BFF",
                      border: plan.highlight ? "none" : "1px solid rgba(91,33,232,0.3)",
                      cursor: checkingOut ? "not-allowed" : "pointer",
                      opacity: checkingOut && !isLoading ? 0.5 : 1,
                    }}
                  >
                    {isLoading ? "Opening checkout…" : `${plan.cta} →`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 flex flex-col items-center gap-3">
          <p className="text-xs" style={{ color: "#3A3A50" }}>
            All plans include a 7-day money-back guarantee. No contracts, cancel anytime.
          </p>
          {currentPlan !== "starter" && (
            <button
              onClick={() => void handleManageSubscription()}
              disabled={portalLoading}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#5A5A70", background: "none", border: "none", cursor: "pointer" }}
            >
              {portalLoading ? "Loading…" : "Manage existing subscription →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
