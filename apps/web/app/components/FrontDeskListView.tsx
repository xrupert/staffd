"use client";

/**
 * FrontDeskListView — W95.4b list views for tasks / follow-ups / leads.
 *
 * Reads the server-ordered top-10 (no client sort/filter — Standard #27 scope
 * guard), renders rows, and opens a read-only SideDrawer on row click with 1–2
 * actions. Actions go through the existing intent commit path (status-update
 * handlers); "Reschedule" opens ConfirmActionModal. No inline editing. STAFFD
 * voice throughout.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../lib/pb";
import SideDrawer from "./SideDrawer";
import ConfirmActionModal, { type IntentResult } from "./ConfirmActionModal";

type Kind = "tasks" | "followups" | "leads";
type Row = Record<string, string> & { id: string };

const CONFIG: Record<Kind, { title: string; empty: string; primary: (r: Row) => string; fields: { key: string; label: string }[] }> = {
  tasks: {
    title: "Tasks", empty: "No tasks yet — tell your Command Center about your next to-do.",
    primary: (r) => r.title || "Task",
    fields: [{ key: "title", label: "Task" }, { key: "due_date", label: "Due" }, { key: "status", label: "Status" }, { key: "notes", label: "Notes" }],
  },
  followups: {
    title: "Follow-ups", empty: "No follow-ups yet — ask your staff to remind you about someone.",
    primary: (r) => r.notes || "Follow-up",
    fields: [{ key: "due_date", label: "Due" }, { key: "status", label: "Status" }, { key: "notes", label: "Notes" }],
  },
  leads: {
    title: "Leads", empty: "No leads yet — tell your Command Center when one comes in.",
    primary: (r) => r.company || r.interest_summary || "Lead",
    fields: [{ key: "company", label: "Company" }, { key: "interest_summary", label: "Interest" }, { key: "source", label: "Source" }, { key: "status", label: "Status" }],
  },
};

export default function FrontDeskListView({ kind }: { kind: Kind }) {
  const cfg = CONFIG[kind];
  const [rows, setRows] = useState<Row[] | null>(null);
  const [active, setActive] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [reschedule, setReschedule] = useState<IntentResult[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/front-desk/${kind}`, { headers: { Authorization: pb.authStore.token } });
      if (res.ok) setRows(((await res.json()).items as Row[]) ?? []);
      else setRows([]);
    } catch { setRows([]); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const commit = useCallback(async (type: string, fields: Record<string, string>) => {
    setBusy(true);
    try {
      await fetch("/api/intent/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ intent_type: type, fields, source: "ui" }),
      });
    } catch { /* swallow — list refetch shows truth */ }
    finally {
      setBusy(false); setActive(null); setReschedule(null);
      await load();
    }
  }, [load]);

  const actions = (r: Row): { label: string; run: () => void }[] => {
    if (kind === "tasks") return [{ label: "Mark done", run: () => void commit("update_task_status", { task_id: r.id, new_status: "done" }) }];
    if (kind === "followups") return [
      { label: "Mark done", run: () => void commit("update_followup_status", { followup_id: r.id, new_status: "done" }) },
      { label: "Reschedule", run: () => setReschedule([{ type: "update_followup_status", fields: { followup_id: r.id, new_status: "pending", new_due_date: r.due_date ?? "" }, confidence: 1 }]) },
    ];
    return [
      { label: "Mark qualified", run: () => void commit("update_lead_status", { lead_id: r.id, new_status: "qualified" }) },
      { label: "Convert to contact", run: () => void commit("update_lead_status", { lead_id: r.id, new_status: "converted" }) },
      { label: "Mark lost", run: () => void commit("update_lead_status", { lead_id: r.id, new_status: "lost" }) },
    ];
  };

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="w-full max-w-2xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Front Desk</a>
        </header>

        <h1 className="font-bold mb-5" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>{cfg.title}</h1>

        {rows === null ? (
          <p className="text-sm" style={{ color: "#7070A0" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm" style={{ color: "#9090A8" }}>{cfg.empty}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => setActive(r)} className="w-full text-left rounded-xl px-4 py-3 flex items-center justify-between gap-3 transition-colors"
                  style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <span className="text-sm truncate" style={{ color: "#E8E8F4" }}>{cfg.primary(r)}</span>
                  <span className="text-xs shrink-0" style={{ color: r.status === "done" || r.status === "converted" ? "#7CD992" : r.status === "lost" ? "#E07070" : "#8A8AA0" }}>
                    {r.due_date || r.status || ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SideDrawer open={!!active} title={active ? cfg.primary(active) : ""} onClose={() => { if (!busy) setActive(null); }}>
        {active && (
          <>
            <dl className="space-y-3 mb-6">
              {cfg.fields.map((f) => (
                <div key={f.key}>
                  <dt className="text-xs uppercase tracking-wider" style={{ color: "#6060A0" }}>{f.label}</dt>
                  <dd className="text-sm mt-0.5" style={{ color: "#D0D0E0" }}>{active[f.key] || "—"}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              {actions(active).map((a) => (
                <button key={a.label} disabled={busy} onClick={a.run}
                  className="text-xs px-3 py-2 rounded-lg font-medium disabled:opacity-50"
                  style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.30)", color: "#A07BFF" }}>
                  {busy ? "…" : a.label}
                </button>
              ))}
            </div>
          </>
        )}
      </SideDrawer>

      {reschedule && (
        <ConfirmActionModal
          intentOptions={reschedule}
          busy={busy}
          onConfirm={(type, f) => { void commit(type, f); }}
          onCancel={() => { if (!busy) setReschedule(null); }}
        />
      )}
    </main>
  );
}
