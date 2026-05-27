"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../lib/pb";

export default function DashboardPage() {
  const [userName, setUserName] = useState("");

  useEffect(() => {
    if (!pb.authStore.isValid) {
      window.location.href = "/auth/login";
      return;
    }
    const model = pb.authStore.record;
    setUserName(model?.name ?? model?.email ?? "");
  }, []);

  return (
    <main
      className="min-h-screen flex flex-col px-6 py-8 relative overflow-hidden"
      style={{ background: "#09090F" }}
    >
      {/* Grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(91, 33, 232, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(91, 33, 232, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between mb-12">
        <a href="/">
          <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
        </a>
        <button
          onClick={() => {
            pb.authStore.clear();
            window.location.href = "/";
          }}
          className="text-sm"
          style={{ color: "#5A5A70" }}
        >
          Sign out
        </button>
      </header>

      {/* Content */}
      <div className="relative z-10 flex-1 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2" style={{ color: "#F0F0F8" }}>
          {userName ? `Welcome, ${userName.split(" ")[0]}.` : "Welcome."}
        </h1>
        <p className="text-base mb-12" style={{ color: "#9090A8" }}>
          Your AI team is getting set up. Choose your first department to get started.
        </p>

        {/* Department cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {DEPARTMENTS.map((dept) => (
            <div
              key={dept.name}
              className="rounded-2xl p-6 flex flex-col gap-3 cursor-pointer transition-all"
              style={{
                background: "#111118",
                border: "1px solid #2A2A38",
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                style={{ background: "#1A1A24" }}
              >
                {dept.icon}
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: "#F0F0F8" }}>{dept.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>{dept.tagline}</p>
              </div>
              <span
                className="text-xs font-medium self-start px-2 py-0.5 rounded-full"
                style={{ background: "#1A1A24", color: "#5B21E8" }}
              >
                Coming soon
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const DEPARTMENTS = [
  { name: "Marketing", icon: "📣", tagline: "Content, SEO, ads & social" },
  { name: "Sales", icon: "🤝", tagline: "Outreach, follow-ups & CRM" },
  { name: "Legal", icon: "⚖️", tagline: "Contracts, policies & compliance" },
  { name: "HR", icon: "👥", tagline: "Hiring, onboarding & culture" },
  { name: "Finance", icon: "💰", tagline: "Budgets, taxes & reporting" },
  { name: "Operations", icon: "⚙️", tagline: "Workflows, SOPs & systems" },
];
