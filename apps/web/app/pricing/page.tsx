"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type Interval = "monthly" | "annual";

interface Plan {
  id: string;
  name: string;
  monthly: number;
  annual: number;     // total per year
  annualMo: number;   // effective monthly when billed annually
  tagline: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  badge?: string;
}

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthly: 39,
    annual: 390,
    annualMo: 32.5,
    tagline: "Six hand-picked specialists, on the clock the moment you sign up.",
    features: [
      "6 hand-picked specialists",
      "Unlimited written work — copy, contracts, briefs",
      "100 HD images + 5 HD videos per month",
      "Business Vault, library & smart memory",
      "3 trial runs of any locked department",
      "Your own booking link — built-in scheduling",
    ],
    cta: "Hire Starter staff",
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 79,
    annual: 790,
    annualMo: 65.83,
    tagline: "Your starter staff plus one full department of specialists.",
    features: [
      "Everything in Starter",
      "1 full department of your choice",
      "300 HD images + 10 HD videos per month",
      "Content calendar with auto-publishing",
      "Email campaign sending",
      "Add more departments at $29/mo each",
    ],
    cta: "Hire Growth staff",
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 149,
    annual: 1490,
    annualMo: 124.17,
    tagline: "Three full departments plus The CEO — your strategic advisor across every team.",
    features: [
      "Everything in Growth",
      "3 full departments of your choice",
      "The CEO included — synthesizes work from every department",
      "600 HD images + 20 HD videos per month",
      "Smart Search across all your team's work",
      "Weekly business briefings",
      "E-signature sending & CRM integration",
      "Add more departments at $29/mo each",
    ],
    cta: "Promote to Pro",
    highlight: true,
    badge: "Most Popular",
  },
  {
    id: "agency",
    name: "Agency",
    monthly: 450,
    annual: 4500,
    annualMo: 375,
    tagline: "Your complete staff. Every department. Built for agencies and operators.",
    features: [
      "All 9 departments fully staffed",
      "The CEO included",
      "1,800 HD images + 60 HD videos per month",
      "Multi-client dashboard with per-client vaults",
      "White-label ready",
      "Priority support",
      "All integrations included",
    ],
    cta: "Talk to us",
  },
];

const DEPARTMENTS = [
  { icon: "📣", name: "Marketing",  count: 16 },
  { icon: "🤝", name: "Sales",      count: 10 },
  { icon: "⚖️", name: "Legal",      count: 6  },
  { icon: "👥", name: "HR",         count: 4  },
  { icon: "💰", name: "Finance",    count: 7  },
  { icon: "⚙️", name: "Operations", count: 12 },
  { icon: "📈", name: "Paid Media", count: 7  },
  { icon: "🎨", name: "Design",     count: 8  },
  { icon: "🛡️", name: "Reputation", count: 5  },
  { icon: "🧭", name: "The CEO",    count: 8  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What's a department, exactly?",
    a: "A department is a roomful of specialists — Marketing has 16 specialists, Sales has 10, Legal has 6, and so on. Walk into a department, describe what you need, and the right specialist handles it. You never have to pick between them.",
  },
  {
    q: "Can I switch plans?",
    a: "Yes — promote, downgrade, or cancel at any time. Promotions take effect immediately, downgrades take effect at the end of your billing period, and you keep your current staff through the end of the period either way.",
  },
  {
    q: "What's a 'trial run'?",
    a: "Every department you haven't hired yet comes with 3 free trial runs so you can test the staff before adding them. After the third run that department locks until you add it for $29/mo or promote to a plan that includes it.",
  },
  {
    q: "Do I own the work my staff produces?",
    a: "Yes. Every document, email, contract, image brief, or strategic plan your staff produces is yours to use commercially, modify, or share. STAFFD retains zero rights to your work.",
  },
  {
    q: "How does The CEO work?",
    a: "The CEO is your strategic advisor across every department — they read what every other team has produced and synthesize across them. Ask 'what should I focus on this week?' and they cite real work from your marketing, sales, finance, and operations. Included on Pro and Agency.",
  },
  {
    q: "Is my business data ever used to train models?",
    a: "No. We use Anthropic's Claude API, which does not train on data sent through the API. We do not use your business data, your staff's work, or any interactions to train any model — ours or anyone else's.",
  },
  {
    q: "Is there a free trial of the platform?",
    a: "No traditional free trial — but every department you haven't hired comes with 3 free trial runs, all plans include a 7-day money-back guarantee, and you can cancel any time. We'd rather earn your business than give the product away.",
  },
  {
    q: "What if I need a custom plan?",
    a: "For larger operations or specialized requirements, reach out at hello@urstaffd.com. The Agency plan covers most multi-client needs out of the box.",
  },
];

export default function PricingPage() {
  const [interval, setInterval] = useState<Interval>("annual"); // default to annual

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      {/* Background grid */}
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
          top: "-200px", left: "50%", transform: "translateX(-50%)",
          width: "900px", height: "600px", borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.15) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10">
        {/* Nav */}
        <header className="flex items-center justify-between mb-16">
          <Link href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/pricing" className="text-xs" style={{ color: "#A07BFF", textDecoration: "none" }}>
              Pricing
            </Link>
            <Link href="/auth/login" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{ background: "#5B21E8", color: "#fff", textDecoration: "none" }}
            >
              Get started
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>
            Pricing
          </p>
          <h1
            className="font-bold mb-4"
            style={{ color: "#F0F0F8", fontSize: "2.75rem", lineHeight: 1.05, letterSpacing: "-0.025em" }}
          >
            Staff your business for less than one freelancer.
          </h1>
          <p className="text-base max-w-2xl mx-auto" style={{ color: "#9090A8", lineHeight: 1.6 }}>
            83 specialists across 10 departments — Marketing, Sales, Legal, HR, Finance,
            Operations, Paid Media, Design, Reputation, and The CEO. On call the moment you hire them.
          </p>
        </div>

        {/* Interval toggle */}
        <div className="flex justify-center mb-12">
          <div
            className="flex items-center gap-1 p-1 rounded-xl"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <button
              onClick={() => setInterval("monthly")}
              className="px-5 py-2 rounded-lg text-xs font-semibold transition-all"
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
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: interval === "annual" ? "#1E1E2E" : "transparent",
                color: interval === "annual" ? "#F0F0F8" : "#5A5A70",
                border: interval === "annual" ? "1px solid #2A2A38" : "1px solid transparent",
              }}
            >
              Annual
              <span
                className="px-1.5 py-0.5 rounded-full font-bold"
                style={{
                  background: "rgba(91,33,232,0.25)",
                  color: "#A07BFF",
                  fontSize: "9px",
                }}
              >
                2 months free
              </span>
            </button>
          </div>
        </div>

        {/* Plans grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-20">
          {PLANS.map((plan) => {
            const isHighlight = plan.highlight;
            const savings = plan.monthly * 12 - plan.annual;

            return (
              <div
                key={plan.id}
                className="rounded-2xl p-6 flex flex-col relative"
                style={{
                  background: isHighlight ? "rgba(91,33,232,0.1)" : "#111118",
                  border: isHighlight ? "1px solid rgba(91,33,232,0.5)" : "1px solid #2A2A38",
                  boxShadow: isHighlight ? "0 0 40px rgba(91,33,232,0.15)" : "none",
                  transform: isHighlight ? "translateY(-8px)" : "none",
                }}
              >
                {plan.badge && (
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
                    {plan.badge}
                  </div>
                )}

                {/* Header — always show the round monthly subscription price.
                    On annual, show the billing note + savings underneath. */}
                <div className="mb-5">
                  <p className="text-sm font-bold mb-2" style={{ color: "#F0F0F8" }}>{plan.name}</p>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="font-bold" style={{ color: "#F0F0F8", fontSize: "2rem", lineHeight: 1, letterSpacing: "-0.02em" }}>
                      ${plan.monthly}
                    </span>
                    <span className="text-xs" style={{ color: "#5A5A70" }}>/mo</span>
                  </div>
                  {interval === "annual" ? (
                    <>
                      <p className="text-xs mb-1" style={{ color: "#4A4A65" }}>
                        Billed annually at ${plan.annual.toLocaleString()}
                      </p>
                      {savings > 0 && (
                        <p className="text-xs" style={{ color: "#22C55E" }}>Save ${savings}/year</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs" style={{ color: "#4A4A65" }}>Billed monthly</p>
                  )}
                  <p className="text-xs leading-snug mt-3" style={{ color: "#7070A0" }}>{plan.tagline}</p>
                </div>

                {/* Features */}
                <ul className="flex flex-col gap-2.5 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs" style={{ color: "#9090A8", lineHeight: 1.5 }}>
                      <span style={{ color: "#5B21E8", flexShrink: 0, marginTop: "2px" }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Link
                  href={`/auth/signup?plan=${plan.id}&interval=${interval}`}
                  className="text-center py-2.5 rounded-xl text-xs font-semibold transition-all w-full"
                  style={{
                    background: isHighlight ? "#5B21E8" : "rgba(91,33,232,0.15)",
                    color: isHighlight ? "#fff" : "#A07BFF",
                    border: isHighlight ? "none" : "1px solid rgba(91,33,232,0.3)",
                    textDecoration: "none",
                    cursor: "pointer",
                  }}
                >
                  {plan.cta} →
                </Link>
              </div>
            );
          })}
        </div>

        {/* Value math — Pro feels inevitable */}
        <div
          className="rounded-2xl p-7 mb-20"
          style={{
            background: "linear-gradient(135deg, rgba(91,33,232,0.1) 0%, rgba(91,33,232,0.03) 100%)",
            border: "1px solid rgba(91,33,232,0.25)",
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <span style={{ fontSize: "18px" }}>💡</span>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#A07BFF" }}>The Pro math</p>
          </div>
          <p className="text-sm mb-3" style={{ color: "#D0D0E8", lineHeight: 1.7 }}>
            On <strong style={{ color: "#F0F0F8" }}>Growth ($79/mo)</strong> you have 1 department on staff. Adding 2 more departments
            costs $29/mo each = <strong style={{ color: "#F0F0F8" }}>$137/mo total</strong>, but you still don&apos;t have The CEO.
          </p>
          <p className="text-sm" style={{ color: "#D0D0E8", lineHeight: 1.7 }}>
            On <strong style={{ color: "#A07BFF" }}>Pro ($149/mo)</strong> you have 3 departments AND The CEO — the strategic advisor
            who synthesizes work from every team. <strong style={{ color: "#F0F0F8" }}>Pro is $12/mo more for The CEO.</strong>
            That&apos;s why most owners promote straight to Pro.
          </p>
        </div>

        {/* Department roster */}
        <div className="mb-20">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Your staff</p>
            <h2 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "1.75rem", letterSpacing: "-0.02em" }}>
              83 specialists. 10 departments.
            </h2>
            <p className="text-sm" style={{ color: "#7070A0" }}>Walk into any department and describe what you need — the right specialist takes it from there.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {DEPARTMENTS.map((d) => (
              <div
                key={d.name}
                className="rounded-xl p-4 text-center"
                style={{ background: "#111118", border: "1px solid #2A2A38" }}
              >
                <div style={{ fontSize: "20px", marginBottom: "6px" }}>{d.icon}</div>
                <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{d.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>{d.count} specialists</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-20">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Questions</p>
            <h2 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", letterSpacing: "-0.02em" }}>
              Frequently asked.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FAQ.map((item) => (
              <div
                key={item.q}
                className="rounded-2xl p-5"
                style={{ background: "#111118", border: "1px solid #2A2A38" }}
              >
                <p className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>{item.q}</p>
                <p className="text-xs" style={{ color: "#9090A8", lineHeight: 1.65 }}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Final CTA */}
        <div
          className="rounded-2xl p-10 text-center mb-12"
          style={{
            background: "linear-gradient(135deg, rgba(91,33,232,0.15) 0%, rgba(91,33,232,0.04) 100%)",
            border: "1px solid rgba(91,33,232,0.3)",
          }}
        >
          <h3 className="font-bold mb-3" style={{ color: "#F0F0F8", fontSize: "1.75rem", letterSpacing: "-0.02em" }}>
            Your staff is waiting.
          </h3>
          <p className="text-sm mb-6 max-w-lg mx-auto" style={{ color: "#9090A8", lineHeight: 1.6 }}>
            Sign up in two minutes, answer a few questions about your business, and your starter staff will be on duty before you finish your coffee.
          </p>
          <Link
            href="/auth/signup"
            className="inline-block px-7 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "#5B21E8", color: "#fff", textDecoration: "none" }}
          >
            Hire your staff →
          </Link>
          <p className="text-xs mt-4" style={{ color: "#5A5A70" }}>
            7-day money-back guarantee · Cancel any time · No contracts
          </p>
        </div>

        {/* Footer */}
        <footer className="pt-8 flex items-center justify-between text-xs" style={{ borderTop: "1px solid #1E1E2A", color: "#3A3A50" }}>
          <p>© {new Date().getFullYear()} STAFFD · Operated by Cybrid Agency</p>
          <div className="flex gap-5">
            <Link href="/privacy" style={{ color: "#3A3A50", textDecoration: "none" }}>Privacy</Link>
            <Link href="/terms" style={{ color: "#3A3A50", textDecoration: "none" }}>Terms</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
