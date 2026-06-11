"use client";

/**
 * Settings → "Your industry support" panel (W58.3 reframe).
 *
 * Industry packs activate automatically from the business industry (D-19
 * bridging, W58.0.1) — this panel is purely informational. It shows which
 * pack the user's industry unlocks and the specialists it adds, with no
 * purchase CTAs. Comp accounts see all 8 verticals active.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type PackCatalogEntry = {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentCount: number;
  departments: string[];
  active: boolean;
};

const DEPT_SHORT: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  "paid-media": "Paid Media",
  design: "Design",
  reputation: "Reputation",
  ceo: "CEO",
};

export default function IndustryPacksPanel() {
  const [packs, setPacks] = useState<PackCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    try {
      const res = await fetch(`/api/packs${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (loading) {
    return (
      <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Your industry support</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  const activePacks = packs.filter((p) => p.active);
  const allActive = packs.length > 0 && activePacks.length === packs.length;

  return (
    <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
      <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Your industry support</h2>
      <p className="text-xs mt-1 mb-4" style={{ color: "#9090A8" }}>
        {allActive
          ? "Industry support active across all 8 verticals"
          : activePacks.length > 0
            ? activePacks
                .map((p) =>
                  `Your business industry unlocks ${p.name} — ${p.agentCount} specialists active across ${p.departments
                    .map((d) => DEPT_SHORT[d] ?? d)
                    .join(", ")}`
                )
                .join(". ")
            : "No industry pack matches your profile yet. Update your industry to unlock industry-specific staff."}
      </p>

      {activePacks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {activePacks.map((p) => (
            <div
              key={p.id}
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{
                background: "rgba(91,33,232,0.06)",
                border: "1px solid rgba(91,33,232,0.3)",
              }}
            >
              <div className="flex items-start gap-3">
                <span style={{ fontSize: "22px" }}>{p.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{p.name}</p>
                    <span
                      className="text-xs px-2 py-0.5 rounded-md flex-shrink-0"
                      style={{ background: "rgba(34,197,94,0.10)", color: "#22C55E", border: "1px solid rgba(34,197,94,0.25)" }}
                    >
                      Active
                    </span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "#9090A8", lineHeight: 1.5 }}>
                    {p.description}
                  </p>
                </div>
              </div>
              <p className="text-xs mt-auto" style={{ color: "#5A5A70" }}>
                {p.agentCount} specialists · {p.departments.map((d) => DEPT_SHORT[d] ?? d).join(", ")}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
};
