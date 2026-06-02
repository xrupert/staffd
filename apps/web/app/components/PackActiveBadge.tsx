"use client";

/**
 * PackActiveBadge — Phase 28 (Pack discovery deeper into UI).
 *
 * The opposite surface to PackUpsellCard. When the user has an ACTIVE pack
 * that adds specialists to this department, show a quiet affirmation so they
 * remember they're getting extra value here. Silent otherwise.
 *
 * Rendered above PackUpsellCard in DepartmentRoom — only one of the two
 * will ever be visible for a given (user, dept) since they have opposite
 * `active` conditions.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

type PackEntry = {
  id: string;
  name: string;
  icon: string;
  departments: string[];
  agentCount: number;
  active: boolean;
};

type Props = { department: string };

export default function PackActiveBadge({ department }: Props) {
  const [activePacks, setActivePacks] = useState<PackEntry[] | null>(null);

  useEffect(() => {
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/packs?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const relevant = (data.packs as PackEntry[])
          .filter((p) => p.active && p.departments.includes(department));
        setActivePacks(relevant);
      } catch { /* silent */ }
    })();
  }, [department]);

  if (!activePacks || activePacks.length === 0) return null;

  return (
    <div
      className="rounded-xl px-3 py-2 mb-3 flex items-center gap-2 flex-wrap"
      style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.20)" }}
    >
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#22C55E" }}>
        Pack active
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        {activePacks.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(34,197,94,0.10)", color: "#9BE3B5", border: "1px solid rgba(34,197,94,0.25)" }}
            title={`${p.name} adds specialists across ${p.departments.length} department${p.departments.length === 1 ? "" : "s"}`}
          >
            <span>{p.icon}</span>
            <span>{p.name}</span>
          </span>
        ))}
      </div>
      <span className="text-xs ml-auto" style={{ color: "#5A5A70" }}>
        Your specialists below include pack-only experts.
      </span>
    </div>
  );
}
