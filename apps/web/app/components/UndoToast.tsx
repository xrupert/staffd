"use client";

/**
 * UndoToast — bottom-center undo affordance for autopilot fires (W95.5).
 *
 * No existing toast pattern in the app (Standard #9 grep: no react-hot-toast /
 * sonner / Toast), so this is a small purpose-built component. Auto-dismisses
 * after 10s; the backend undo window stays open ~10 min via the activity log.
 * Click Undo → POST /api/intent/commit { intent_type: "undo", audit_row_id }.
 * STAFFD voice; zero vendor names.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

export default function UndoToast({ auditRowId, message, onClose }: { auditRowId: string; message: string; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "undoing" | "reverted" | "error">("idle");

  useEffect(() => {
    if (state !== "idle") return;
    const t = setTimeout(onClose, 10_000);
    return () => clearTimeout(t);
  }, [state, onClose]);

  useEffect(() => {
    if (state !== "reverted") return;
    const t = setTimeout(onClose, 2_000);
    return () => clearTimeout(t);
  }, [state, onClose]);

  async function undo() {
    setState("undoing");
    try {
      const res = await fetch("/api/intent/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ intent_type: "undo", fields: { audit_row_id: auditRowId }, source: "ui" }),
      });
      setState(res.ok ? "reverted" : "error");
    } catch { setState("error"); }
  }

  const text =
    state === "reverted" ? "Reverted — never happened." :
    state === "error" ? "That undo window has closed — find it in your activity log." :
    message;

  return (
    <div style={{ position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 80 }}>
      <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
        style={{ background: "#15151E", border: "1px solid #2A2A38", color: "#E8E8F4", boxShadow: "0 10px 40px rgba(0,0,0,0.45)", maxWidth: "90vw" }}>
        <span>{text}</span>
        {state === "idle" && (
          <button onClick={() => void undo()} className="font-semibold" style={{ color: "#A07BFF", background: "transparent", border: "none", cursor: "pointer" }}>
            Undo
          </button>
        )}
        {state === "undoing" && <span style={{ color: "#7070A0" }}>Undoing…</span>}
        <button onClick={onClose} aria-label="Dismiss" style={{ color: "#5A5A70", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}
