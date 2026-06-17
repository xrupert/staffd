"use client";

/**
 * ConfirmActionModal — the reusable confirm-to-commit primitive (W95.1, Model B3).
 *
 * Generalizes ActionRecipientModal / ScheduleFollowupModal: an intent is
 * extracted from what the owner said, the parsed fields are shown as an
 * editable preview, and on confirm they flow through the single commit path
 * (/api/intent/commit). Every intent type reuses this one component.
 *
 * STAFFD voice throughout — no vendor names ever surface (the backend the
 * contact mirrors to is invisible to the customer).
 */

import { useEffect, useState } from "react";

export type IntentResult = { type: string; fields: Record<string, string>; confidence: number };

// Per-intent presentation: human title + which fields to show, in order.
const INTENT_UI: Record<string, { title: string; fields: { key: string; label: string }[] }> = {
  create_contact: {
    title: "Add this contact?",
    fields: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "context", label: "Context" },
    ],
  },
};

const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", padding: "16px" };
const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "420px" };
const input: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", outline: "none", width: "100%" };

export default function ConfirmActionModal({
  intentResult,
  busy = false,
  onConfirm,
  onCancel,
}: {
  intentResult: IntentResult;
  busy?: boolean;
  onConfirm: (editedFields: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const ui = INTENT_UI[intentResult.type] ?? { title: "Confirm?", fields: Object.keys(intentResult.fields).map((k) => ({ key: k, label: k })) };
  const [fields, setFields] = useState<Record<string, string>>(intentResult.fields);
  useEffect(() => setFields(intentResult.fields), [intentResult]);

  return (
    <div style={overlay} onClick={busy ? undefined : onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-sm mb-1" style={{ color: "#F0F0F8" }}>{ui.title}</p>
        <p className="text-xs mb-4" style={{ color: "#7070A0" }}>Your staff caught this — check it over and confirm, or tweak anything that&apos;s off.</p>

        <div className="flex flex-col gap-2.5 mb-5">
          {ui.fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{f.label}</label>
              <input
                style={input}
                value={fields[f.key] ?? ""}
                placeholder={`Add ${f.label.toLowerCase()}…`}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled={busy || !(fields.name ?? "").trim()}
            onClick={() => onConfirm(fields)}
            className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ opacity: busy || !(fields.name ?? "").trim() ? 0.5 : 1 }}
          >
            {busy ? "Saving…" : "Confirm"}
          </button>
          <button disabled={busy} onClick={onCancel} className="px-4 py-2 rounded-xl text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
