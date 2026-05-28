"use client";

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  cta: string;
  highlight: boolean;
}

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$39",
    period: "/mo",
    tagline: "6 curated AI specialists, ready to work.",
    features: [
      "6 hand-picked AI agents",
      "Unlimited generations",
      "Document library",
      "PDF & Word export",
      "Business Vault",
      "3 trial runs per locked department",
    ],
    cta: "Current plan",
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    price: "$79",
    period: "/mo",
    tagline: "Your starter team plus one full department.",
    features: [
      "Everything in Starter",
      "1 full department (your choice)",
      "All specialists in that department",
      "Content calendar",
      "Email campaign sending",
      "Extra departments at $29/mo each",
    ],
    cta: "Upgrade to Growth",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$149",
    period: "/mo",
    tagline: "Three departments and a strategic advisor.",
    features: [
      "Everything in Growth",
      "3 full departments (your choice)",
      "CEO — strategic advisor included",
      "E-signature sending",
      "CRM integration",
      "Weekly business briefings",
    ],
    cta: "Upgrade to Pro",
    highlight: true,
  },
  {
    id: "agency",
    name: "Agency",
    price: "$450",
    period: "/mo",
    tagline: "The full team. All 8 departments.",
    features: [
      "All 8 departments",
      "CEO included",
      "Multi-client dashboard",
      "White-label ready",
      "Priority support",
      "All integrations",
    ],
    cta: "Upgrade to Agency",
    highlight: false,
  },
];

interface UpgradeModalProps {
  department: string;
  currentPlan?: string;
  onClose: () => void;
}

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", ceo: "Strategy",
  "paid-media": "Paid Media", design: "Design",
};

export default function UpgradeModal({ department, currentPlan = "starter", onClose }: UpgradeModalProps) {
  const deptLabel = DEPT_LABELS[department] ?? department;

  // Stripe checkout URLs — replace with real links when Stripe is wired up
  const checkoutUrl = "#upgrade"; // TODO: replace with Stripe checkout links per plan

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-2xl overflow-hidden"
        style={{ background: "#0D0D14", border: "1px solid #2A2A38", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-8 py-6 flex items-start justify-between"
          style={{ borderBottom: "1px solid #1E1E2A" }}
        >
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

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px p-6 gap-4">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                className="rounded-xl p-5 flex flex-col"
                style={{
                  background: plan.highlight ? "rgba(91,33,232,0.1)" : "#111118",
                  border: plan.highlight
                    ? "1px solid rgba(91,33,232,0.5)"
                    : "1px solid #2A2A38",
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
                  <div className="flex items-baseline gap-0.5 mb-2">
                    <span className="text-2xl font-bold" style={{ color: "#F0F0F8" }}>{plan.price}</span>
                    <span className="text-xs" style={{ color: "#5A5A70" }}>{plan.period}</span>
                  </div>
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
                  <a
                    href={checkoutUrl}
                    className="text-center py-2.5 rounded-xl text-xs font-semibold transition-all block"
                    style={{
                      background: plan.highlight ? "#5B21E8" : "rgba(91,33,232,0.15)",
                      color: plan.highlight ? "#fff" : "#A07BFF",
                      border: plan.highlight ? "none" : "1px solid rgba(91,33,232,0.3)",
                      textDecoration: "none",
                    }}
                  >
                    {plan.cta} →
                  </a>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-8 pb-6 text-center">
          <p className="text-xs" style={{ color: "#3A3A50" }}>
            All plans include a 7-day money-back guarantee. No contracts, cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
