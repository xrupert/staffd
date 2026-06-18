"use client";

/**
 * AutomationSettings — the /dashboard/settings "Automation" section (W95.5).
 *
 * Lists every autopilot-eligible action with its on/off state + toggle. Toggle
 * ON = the "Yes, automate it" graduation choice; OFF preserves the streak but
 * suppresses the offer 30 days. STAFFD voice; no vendor names.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type Pref = { intent_type: string; label: string; policy: string; threshold: number; streak: number; enabled: boolean; enabled_at: string | null };

export default function AutomationSettings() {
  const [items, setItems] = useState<Pref[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autopilot/prefs", { headers: { Authorization: pb.authStore.token } });
      if (res.ok) setItems(((await res.json()).items as Pref[]) ?? []);
      else setItems([]);
    } catch { setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (p: Pref) => {
    setBusy(p.intent_type);
    try {
      await fetch(`/api/autopilot/${p.enabled ? "disable" : "enable"}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ intent_type: p.intent_type }),
      });
    } catch { /* reflect truth on reload */ }
    finally { setBusy(null); await load(); }
  };

  return (
    <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: "#F0F0F8" }}>Automation</h2>
      <p className="text-xs mb-5" style={{ color: "#7070A0" }}>
        Once your staff have proven they get something right, let STAFFD handle it automatically. You can turn any of these off here.
      </p>
      {items === null ? (
        <p className="text-xs" style={{ color: "#7070A0" }}>Loading…</p>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.intent_type} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "#0E0E15", border: "1px solid #1E1E28" }}>
              <div>
                <p className="text-sm" style={{ color: "#E8E8F4" }}>{p.label}</p>
                <p className="text-xs mt-0.5" style={{ color: p.enabled ? "#7CD992" : "#6A6A80" }}>
                  {p.enabled ? `On${p.enabled_at ? ` since ${new Date(p.enabled_at).toLocaleDateString()}` : ""}` : "Off"}
                </p>
              </div>
              <button onClick={() => void toggle(p)} disabled={busy === p.intent_type}
                className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                style={p.enabled
                  ? { background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E0" }
                  : { background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.30)", color: "#A07BFF" }}>
                {busy === p.intent_type ? "…" : p.enabled ? "Turn off" : "Turn on"}
              </button>
            </div>
          ))}
          {items.every((p) => !p.enabled) && (
            <p className="text-xs mt-2" style={{ color: "#6A6A80" }}>Nothing automated yet — STAFFD will offer once it&apos;s gotten an action right a few times.</p>
          )}
        </div>
      )}
    </section>
  );
}
