"use client";

/**
 * ScheduleFollowupModal (W64 B2, SA Decision 13) — shared by DepartmentRoom
 * and CommandCenter for the schedule_followup action.
 *
 * Distinct from DeptRoom's "Schedule for review" modal: this writes
 * `status: "planned"` to scheduled_content, which the scheduled worker
 * picks up on the due date and actually RUNS as agent work — so the task
 * field is editable (it's the prompt the agent will execute, not a
 * calendar note).
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

interface Props {
  open: boolean;
  onClose: () => void;
  department: string;
  agentName: string;
  /** Seed for the editable task — what the agent will execute on the date. */
  seedTask: string;
}

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export default function ScheduleFollowupModal({ open, onClose, department, agentName, seedTask }: Props) {
  const [date, setDate] = useState(defaultDate);
  const [taskText, setTaskText] = useState(seedTask);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Re-seed when (re)opened — each open is a fresh follow-up.
  useEffect(() => {
    if (open) {
      setTaskText(seedTask);
      setDate(defaultDate());
      setMsg("");
    }
  }, [open, seedTask]);

  if (!open) return null;

  async function save() {
    if (!date || !taskText.trim() || saving) return;
    setSaving(true);
    setMsg("");
    try {
      const userId = pb.authStore.record?.id ?? "";
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      await pb.collection("scheduled_content").create({
        user: userId,
        department,
        agent_name: agentName,
        task: taskText.trim(),
        scheduled_date: date,
        status: "planned",
        client: activeClientId ?? "",
      });
      setMsg("Follow-up scheduled — your team will run it on that date.");
      setTimeout(() => {
        onClose();
        setMsg("");
      }, 1500);
    } catch {
      setMsg("Couldn't schedule — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-7 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#5B21E8" }}>Schedule a follow-up</p>
            <h2 className="text-lg font-bold" style={{ color: "#F0F0F8" }}>Your team runs this on the date you pick</h2>
            <p className="text-xs mt-1" style={{ color: "#5A5A70" }}>Edit the task below — it&apos;s exactly what gets executed.</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70", fontSize: "22px" }}>×</button>
        </div>
        <div className="p-7">
          <textarea
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            rows={4}
            aria-label="Follow-up task"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-3 resize-none"
            style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            aria-label="Follow-up date"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-3"
            style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
          />
          {msg && (
            <p className="text-xs mb-3" style={{ color: msg.includes("Couldn") ? "#EF4444" : "#22C55E" }}>{msg}</p>
          )}
          <button
            onClick={() => void save()}
            disabled={!date || !taskText.trim() || saving}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{
              background: "#5B21E8",
              border: "none",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: !date || !taskText.trim() || saving ? 0.5 : 1,
            }}
          >
            {saving ? "Scheduling…" : "Schedule follow-up →"}
          </button>
        </div>
      </div>
    </div>
  );
}
