"use client";

import { useState, useEffect } from "react";
import { VALID_PLANS, type Plan } from "../../../lib/hooks/useEffectivePlan";

/**
 * /dashboard/admin — super-admin landing page (Decision 74).
 *
 * Lists all admin surfaces with deep links. Auth + page-view logging
 * handled by the parent layout.tsx; this page is just a navigation index.
 *
 * Future admin surfaces added here as built. Log viewer pages
 * (audit-log / usage-log) DEFERRED per Decision 74 simplification —
 * view via PB admin UI for now.
 */

import Image from "next/image";
import IntegrationsHealthPanel from "../../components/IntegrationsHealthPanel";
import BusinessPulseWidget from "../../components/BusinessPulseWidget";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";

type AdminSurface = {
  href: string;
  title: string;
  description: string;
  status: "live" | "deferred";
};

const SURFACES: AdminSurface[] = [
  {
    href: "/dashboard/admin/security",
    title: "Multi-Tenant Security",
    description: "Verify + repair PocketBase row rules. Orphan investigation panel.",
    status: "live",
  },
  {
    href: "/dashboard/admin/vault-metrics",
    title: "Vault Metrics",
    description: "Ingestion queue depths, document throughput, brief delivery, conversation thread counts.",
    status: "live",
  },
  {
    href: "/dashboard/admin/usage",
    title: "Usage",
    description: "Fleet-wide activity: users by type/plan, department + specialist output, integration outcomes, workflow execution stats.",
    status: "live",
  },
];

const DEFERRED_VIEWERS = [
  {
    title: "Audit Log Viewer",
    pb_collection: "super_admin_audit_log",
    description: "Every super-admin bypass, dashboard access, and admin route call.",
  },
  {
    title: "Usage Log Viewer",
    pb_collection: "super_admin_usage_log",
    description: "Premium operations triggered by super-admin (agent calls, image gen, etc.).",
  },
];

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

const PLAN_LABELS: Record<Plan, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  agency: "Agency",
};

function ViewAsPlanCard() {
  const [selected, setSelected] = useState<Plan | "off">("off");

  useEffect(() => {
    const stored = localStorage.getItem("staffd_view_as_plan") as Plan | null;
    setSelected(stored && (VALID_PLANS as readonly string[]).includes(stored) ? stored : "off");
  }, []);

  function pick(value: Plan | "off") {
    setSelected(value);
    if (value === "off") {
      localStorage.removeItem("staffd_view_as_plan");
    } else {
      localStorage.setItem("staffd_view_as_plan", value);
    }
    window.dispatchEvent(new StorageEvent("storage", { key: "staffd_view_as_plan" }));
  }

  return (
    <section className="mb-10">
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#7070A0" }}>
        View Dashboard As
      </h2>
      <div style={{ ...cardStyle, display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        {(["off", ...VALID_PLANS] as const).map((v) => (
          <label
            key={v}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              padding: "6px 14px",
              borderRadius: "8px",
              border: selected === v ? "1px solid rgba(91,33,232,0.6)" : "1px solid #2A2A38",
              background: selected === v ? "rgba(91,33,232,0.15)" : "transparent",
              color: selected === v ? "#A07BFF" : "#7070A0",
              fontSize: "12px",
              fontWeight: 500,
              transition: "all 0.15s",
            }}
          >
            <input
              type="radio"
              name="view-as-plan"
              value={v}
              checked={selected === v}
              onChange={() => pick(v)}
              style={{ display: "none" }}
            />
            {v === "off" ? "Off (use actual plan)" : PLAN_LABELS[v]}
          </label>
        ))}
        <p className="text-xs w-full mt-2" style={{ color: "#5A5A70" }}>
          Presentation-only — does not affect server-side credits or billing.
        </p>
      </div>
    </section>
  );
}

export default function AdminIndexPage() {
  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">
        <header className="mb-10">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
        </header>

        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>
            Operator
          </p>
          <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Admin
          </h1>
          <p className="text-xs mt-2" style={{ color: "#5A5A70" }}>
            Super-admin tools. All actions logged to <code style={{ color: "#A07BFF" }}>super_admin_audit_log</code>.
          </p>
        </div>

        <section className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#7070A0" }}>
            Surfaces
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {SURFACES.map((s) => (
              <a key={s.href} href={s.href} className="block transition-transform hover:-translate-y-px" style={cardStyle}>
                <p className="font-semibold mb-1" style={{ color: "#F0F0F8" }}>
                  {s.title}
                </p>
                <p className="text-xs" style={{ color: "#7070A0" }}>
                  {s.description}
                </p>
              </a>
            ))}
          </div>
        </section>

        <BusinessPulseWidget />

        <IntegrationsHealthPanel />

        <ViewAsPlanCard />

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#7070A0" }}>
            Deferred — view in PocketBase admin UI
          </h2>
          <p className="text-xs mb-3" style={{ color: "#5A5A70" }}>
            Per Decision 74 simplification, dedicated viewer pages are deferred until needed. Open PB admin and browse the collection directly.
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {DEFERRED_VIEWERS.map((v) => (
              <div key={v.pb_collection} style={{ ...cardStyle, opacity: 0.8 }}>
                <p className="font-semibold mb-1" style={{ color: "#D0D0E8" }}>
                  {v.title}
                </p>
                <p className="text-xs mb-2" style={{ color: "#7070A0" }}>
                  {v.description}
                </p>
                <p className="text-xs font-mono" style={{ color: "#A07BFF" }}>
                  PB collection: {v.pb_collection}
                </p>
                {PB_URL && (
                  <a
                    href={`${PB_URL.replace(/\/$/, "")}/_/#/collections?collection=${v.pb_collection}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs mt-2 inline-block"
                    style={{ color: "#A07BFF" }}
                  >
                    Open in PB admin →
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
