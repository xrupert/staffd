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
import IndustryCategoryPicker from "./IndustryCategoryPicker";
import { type IndustryCategoryId } from "../../lib/industry-categories";

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
  // W59 — inline industry edit (the recovery path for legacy users whose
  // industry never got captured, and the change path for everyone else).
  const [editing, setEditing] = useState(false);
  const [editCategory, setEditCategory] = useState<IndustryCategoryId | "">("");
  const [editDetail, setEditDetail] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  async function saveIndustry() {
    if (!editCategory) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      if (!userId) throw new Error("not signed in");
      const payload: Record<string, string> = { industry_category: editCategory };
      if (editDetail.trim()) payload.industry = editDetail.trim();
      // Same client-side PB write pattern as onboarding — row rules
      // authorize own-record writes; no new endpoint needed (Decision 6).
      const existing = await pb.collection("businesses").getList(1, 1, {
        filter: `user = '${userId}'`,
      });
      if (existing.items.length > 0 && existing.items[0]) {
        await pb.collection("businesses").update(existing.items[0].id, payload);
      } else {
        await pb.collection("businesses").create({ user: userId, ...payload });
      }
      setEditing(false);
      setLoading(true);
      await load(); // refetch /api/packs — activePacks re-resolves per request
    } catch {
      setEditError("Couldn't save. Try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Your industry support</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium transition-colors hover:text-white flex-shrink-0"
            style={{ color: "#A07BFF" }}
          >
            Change industry →
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 mb-4 flex flex-col gap-3">
          <p className="text-xs" style={{ color: "#9090A8" }}>What kind of business do you run?</p>
          <IndustryCategoryPicker value={editCategory} onChange={setEditCategory} compact />
          <input
            value={editDetail}
            onChange={(e) => setEditDetail(e.target.value)}
            placeholder="Anything else about your business? (optional)"
            className="rounded-xl px-3 py-2 text-xs"
            style={{ background: "#0D0D16", border: "1px solid #2A2A38", color: "#F0F0F8" }}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => void saveIndustry()}
              disabled={!editCategory || savingEdit}
              className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ opacity: !editCategory || savingEdit ? 0.5 : 1 }}
            >
              {savingEdit ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setEditError(null); }}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#5A5A70" }}
            >
              Cancel
            </button>
            {editError && <span className="text-xs" style={{ color: "#EF4444" }}>{editError}</span>}
          </div>
        </div>
      )}

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
