"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import CommandCenter from "../components/CommandCenter";

const DEPARTMENTS = [
  { name: "Marketing", icon: "📣", tagline: "Content, campaigns & social", href: "/dashboard/marketing" },
  { name: "Sales", icon: "🤝", tagline: "Outreach, proposals & closing", href: "/dashboard/sales" },
  { name: "Legal", icon: "⚖️", tagline: "Contracts, policies & compliance", href: "/dashboard/legal" },
  { name: "HR", icon: "👥", tagline: "Hiring, onboarding & performance", href: "/dashboard/hr" },
  { name: "Finance", icon: "💰", tagline: "Invoices, budgets & projections", href: "/dashboard/finance" },
  { name: "Operations", icon: "⚙️", tagline: "SOPs, workflows & systems", href: "/dashboard/operations" },
  { name: "Paid Media", icon: "📈", tagline: "Google, Meta & ad strategy", href: "/dashboard/paid-media" },
  { name: "Design", icon: "🎨", tagline: "Brand, visuals & UI direction", href: "/dashboard/design" },
];

export default function DashboardPage() {
  const [userName, setUserName] = useState("");
  const [initials, setInitials] = useState("");
  const [vaultPct, setVaultPct] = useState<number | null>(null);

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
    void loadVaultHealth();
  }, []);

  async function loadVaultHealth() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("businesses").getList(1, 1, { filter: `user = '${userId}'` });
      const rec = res.items[0];
      if (rec) {
        const coreFields = ["business_name", "industry", "description", "target_audience"] as const;
        const filled = coreFields.filter((k) => !!(rec[k] as string)?.trim()).length;
        setVaultPct(Math.round((filled / coreFields.length) * 100));
      } else {
        setVaultPct(0);
      }
    } catch { /* proceed */ }
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
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
          top: "-200px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "800px",
          height: "600px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.12) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <a href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
          </a>
          <div className="flex items-center gap-4">
            <a href="/dashboard/library" className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55", textDecoration: "none" }}>
              Library
            </a>
            <a href="/dashboard/settings" style={{ textDecoration: "none" }}>
              {initials ? (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all hover:border-purple-500"
                  style={{ background: "rgba(91,33,232,0.2)", color: "#7C4FF0", border: "1px solid rgba(91,33,232,0.3)", cursor: "pointer" }}
                  title="Account settings"
                >
                  {initials}
                </div>
              ) : (
                <span className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55" }}>Settings</span>
              )}
            </a>
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
        <div className="mb-8">
          <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "2rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {userName ? `Welcome back, ${userName}.` : "Welcome back."}
          </h1>
          <p className="text-sm" style={{ color: "#5A5A70" }}>
            Your AI team is ready.
          </p>
        </div>

        {/* Vault health nudge — only shown when vault is incomplete */}
        {vaultPct !== null && vaultPct < 75 && (
          <a
            href="/dashboard/vault"
            style={{ textDecoration: "none", display: "block", marginBottom: "20px" }}
          >
            <div
              className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all"
              style={{
                background: "rgba(245,158,11,0.05)",
                border: "1px solid rgba(245,158,11,0.2)",
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
              >
                ⚡
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#F0F0E8" }}>
                  Your AI team is working with {vaultPct}% of the context they need
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#7A6A40" }}>
                  Fill in your Business Vault — the more they know, the better the output →
                </p>
              </div>
              <div
                className="flex-shrink-0"
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "#F59E0B",
                }}
              >
                {vaultPct}%
              </div>
            </div>
          </a>
        )}

        {/* Command Center chat */}
        <CommandCenter />

        {/* Utility row: Vault + CEO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <a
            href="/dashboard/vault"
            className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all"
            style={{
              background: "rgba(91,33,232,0.06)",
              border: "1px solid rgba(91,33,232,0.25)",
              textDecoration: "none",
            }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.15)", border: "1px solid rgba(91,33,232,0.25)" }}>
              🔐
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Business Vault</p>
              <p className="text-xs" style={{ color: "#5A5A70" }}>Your business profile for all agents</p>
            </div>
            <span className="text-xs font-semibold" style={{ color: "#5B21E8" }}>Edit →</span>
          </a>

          <a
            href="/dashboard/ceo"
            className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all"
            style={{
              background: "rgba(91,33,232,0.08)",
              border: "1px solid rgba(91,33,232,0.3)",
              textDecoration: "none",
            }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.35)" }}>
              🎯
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>The CEO</p>
              <p className="text-xs" style={{ color: "#5A5A70" }}>Strategic advisor & business planning</p>
            </div>
            <span className="text-xs font-semibold" style={{ color: "#5B21E8" }}>Ask →</span>
          </a>
        </div>

        {/* Department grid */}
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#3A3A50" }}>
          Go directly to a department
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
          {DEPARTMENTS.map((dept) => (
            <a
              key={dept.name}
              href={dept.href}
              className="rounded-xl p-4 flex flex-col gap-2.5 transition-all group"
              style={{
                background: "#111118",
                border: "1px solid #2A2A38",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(91,33,232,0.5)";
                (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#2A2A38";
                (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
              }}
            >
              <div className="text-xl">{dept.icon}</div>
              <div>
                <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>{dept.name}</p>
                <p className="text-xs mt-0.5 leading-snug" style={{ color: "#3A3A50" }}>{dept.tagline}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
