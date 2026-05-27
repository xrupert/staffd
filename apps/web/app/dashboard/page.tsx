"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../lib/pb";

const DEPARTMENTS = [
  { name: "Marketing", icon: "📣", tagline: "Content, SEO, ads & social", href: "/dashboard/marketing" },
  { name: "Sales", icon: "🤝", tagline: "Outreach, follow-ups & CRM", href: "/dashboard/sales" },
  { name: "Legal", icon: "⚖️", tagline: "Contracts, policies & compliance", href: "/dashboard/legal" },
  { name: "HR", icon: "👥", tagline: "Hiring, onboarding & culture", href: "/dashboard/hr" },
  { name: "Finance", icon: "💰", tagline: "Budgets, invoicing & reporting", href: "/dashboard/finance" },
  { name: "Operations", icon: "⚙️", tagline: "Workflows, SOPs & systems", href: "/dashboard/operations" },
];

export default function DashboardPage() {
  const [userName, setUserName] = useState("");
  const [initials, setInitials] = useState("");

  useEffect(() => {
    if (!pb.authStore.isValid) {
      window.location.href = "/auth/login";
      return;
    }
    const model = pb.authStore.record;
    const name = model?.name ?? "";
    setUserName(name.split(" ")[0] ?? model?.email ?? "");
    const parts = name.trim().split(" ");
    setInitials(
      parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase()
    );
  }, []);

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      {/* Grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      {/* Purple glow top-center */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: "-200px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "800px",
          height: "600px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.12) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <header className="flex items-center justify-between mb-14">
          <a href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
          </a>
          <div className="flex items-center gap-4">
            {initials && (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: "rgba(91,33,232,0.2)", color: "#7C4FF0", border: "1px solid rgba(91,33,232,0.3)" }}
              >
                {initials}
              </div>
            )}
            <button
              onClick={() => { pb.authStore.clear(); window.location.href = "/"; }}
              className="text-sm transition-colors hover:text-white"
              style={{ color: "#5A5A70" }}
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Welcome */}
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>
            Command Center
          </p>
          <h1 className="font-bold mb-3" style={{ color: "#F0F0F8", fontSize: "2.5rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {userName ? `Welcome back, ${userName}.` : "Welcome back."}
          </h1>
          <p className="text-base" style={{ color: "#9090A8", maxWidth: "480px" }}>
            Your AI team is ready. Choose a department or fill in your Vault so they know your business.
          </p>
        </div>

        {/* Vault CTA */}
        <a
          href="/dashboard/vault"
          className="flex items-center justify-between rounded-2xl px-6 py-5 mb-8 transition-all group"
          style={{
            background: "linear-gradient(135deg, rgba(91,33,232,0.12) 0%, rgba(91,33,232,0.04) 100%)",
            border: "1px solid rgba(91,33,232,0.3)",
            textDecoration: "none",
          }}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.3)" }}
            >
              🔐
            </div>
            <div>
              <p className="text-sm font-semibold mb-0.5" style={{ color: "#F0F0F8" }}>Your Business Vault</p>
              <p className="text-xs" style={{ color: "#7070A0" }}>
                Your business profile — your AI team reads this before every task
              </p>
            </div>
          </div>
          <span
            className="text-xs font-semibold px-3.5 py-1.5 rounded-full flex-shrink-0 ml-4 transition-all"
            style={{ background: "rgba(91,33,232,0.2)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.4)" }}
          >
            Edit →
          </span>
        </a>

        {/* CEO CTA */}
        <a
          href="/dashboard/ceo"
          className="flex items-center justify-between rounded-2xl px-6 py-5 mb-8 transition-all group"
          style={{
            background: "linear-gradient(135deg, rgba(91,33,232,0.18) 0%, rgba(124,79,240,0.08) 100%)",
            border: "1px solid rgba(91,33,232,0.4)",
            textDecoration: "none",
          }}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.25)", border: "1px solid rgba(91,33,232,0.4)" }}
            >
              🎯
            </div>
            <div>
              <p className="text-sm font-semibold mb-0.5" style={{ color: "#F0F0F8" }}>The CEO</p>
              <p className="text-xs" style={{ color: "#7070A0" }}>
                Cross-department strategic advisor — plans, priorities & key decisions
              </p>
            </div>
          </div>
          <span
            className="text-xs font-semibold px-3.5 py-1.5 rounded-full flex-shrink-0 ml-4 transition-all"
            style={{ background: "rgba(91,33,232,0.2)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.4)" }}
          >
            Ask →
          </span>
        </a>

        {/* Section label */}
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#5A5A70" }}>
          Departments
        </p>

        {/* Department grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DEPARTMENTS.map((dept) =>
            dept.href ? (
              <a
                key={dept.name}
                href={dept.href}
                style={{ textDecoration: "none" }}
              >
                <DeptCard dept={dept} active />
              </a>
            ) : (
              <DeptCard key={dept.name} dept={dept} active={false} />
            )
          )}
        </div>
      </div>
    </main>
  );
}

function DeptCard({
  dept,
  active,
}: {
  dept: { name: string; icon: string; tagline: string };
  active: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-6 flex flex-col gap-4 transition-all"
      style={{
        background: active
          ? "linear-gradient(135deg, #13111E 0%, #111118 100%)"
          : "#111118",
        border: active ? "1px solid rgba(91,33,232,0.45)" : "1px solid #2A2A38",
        cursor: active ? "pointer" : "default",
        boxShadow: active ? "0 0 24px rgba(91,33,232,0.08)" : "none",
      }}
      onMouseEnter={(e) => {
        if (active) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(91,33,232,0.7)";
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 32px rgba(91,33,232,0.15)";
        } else {
          (e.currentTarget as HTMLDivElement).style.borderColor = "#3A3A50";
        }
      }}
      onMouseLeave={(e) => {
        if (active) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(91,33,232,0.45)";
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 24px rgba(91,33,232,0.08)";
        } else {
          (e.currentTarget as HTMLDivElement).style.borderColor = "#2A2A38";
        }
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-xl"
        style={{
          background: active ? "rgba(91,33,232,0.15)" : "#1A1A24",
          border: active ? "1px solid rgba(91,33,232,0.25)" : "1px solid #2A2A38",
        }}
      >
        {dept.icon}
      </div>
      <div className="flex-1">
        <p className="font-semibold text-sm mb-1" style={{ color: "#F0F0F8" }}>{dept.name}</p>
        <p className="text-xs leading-relaxed" style={{ color: "#5A5A70" }}>{dept.tagline}</p>
      </div>
      <span
        className="text-xs font-semibold self-start px-2.5 py-1 rounded-full"
        style={
          active
            ? { background: "rgba(91,33,232,0.18)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.35)" }
            : { background: "#1A1A24", color: "#3A3A50", border: "1px solid #2A2A38" }
        }
      >
        {active ? "Active" : "Coming soon"}
      </span>
    </div>
  );
}
