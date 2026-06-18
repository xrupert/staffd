"use client";

/**
 * /dashboard/admin/activity — autopilot activity log (W95.5, super-admin).
 * Gated by the /dashboard/admin layout. Lists recent autopilot fires across
 * users with a derived status; operator can undo within the window. V1 is
 * operator-only (user-facing log is V1.5).
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../../../lib/pb";

type Row = { id: string; user: string; intent_type: string; target_collection: string; committed_at: string; undo_window_expires_at: string; status: "active" | "undone" | "expired" };

const statusColor: Record<string, string> = { active: "#7CD992", undone: "#7070A0", expired: "#6A6A80" };

export default function ActivityPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/activity?pbToken=${encodeURIComponent(pb.authStore.token)}`);
      if (!res.ok) { setError(res.status === 403 ? "Super-admin only." : "Couldn't load activity."); return; }
      setError("");
      setRows(((await res.json()).items as Row[]) ?? []);
    } catch { setError("Couldn't load activity."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const undo = async (r: Row) => {
    setBusy(r.id);
    try {
      await fetch("/api/intent/commit", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ intent_type: "undo", fields: { audit_row_id: r.id }, source: "ui" }),
      });
    } catch { /* reflect on reload */ }
    finally { setBusy(null); await load(); }
  };

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="w-full max-w-3xl mx-auto px-6 py-8">
        <h1 className="font-bold mb-1" style={{ color: "#F0F0F8", fontSize: "1.4rem" }}>Autopilot activity</h1>
        <p className="text-sm mb-6" style={{ color: "#9090A8" }}>Actions STAFFD took automatically. Undo any still inside its window.</p>
        {error && <p className="text-sm mb-4" style={{ color: "#E08080" }}>{error}</p>}
        {rows === null ? <p className="text-sm" style={{ color: "#7070A0" }}>Loading…</p>
          : rows.length === 0 ? <p className="text-sm" style={{ color: "#9090A8" }}>No autopilot activity yet.</p>
          : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: "#E8E8F4" }}>{r.intent_type} <span style={{ color: "#5A5A70" }}>· {r.target_collection}</span></p>
                    <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>{new Date(r.committed_at).toLocaleString()} · user {String(r.user).slice(0, 8)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs" style={{ color: statusColor[r.status] }}>{r.status}</span>
                    {r.status === "active" && (
                      <button onClick={() => void undo(r)} disabled={busy === r.id}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                        style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#A07BFF" }}>
                        {busy === r.id ? "…" : "Undo"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </main>
  );
}
