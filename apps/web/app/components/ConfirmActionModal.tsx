"use client";

/**
 * ConfirmActionModal — the reusable confirm-to-commit primitive (W95.1 / .4a / .4b).
 *
 * An intent is extracted from what the owner said and shown as an editable
 * preview; on confirm the fields flow through the single commit path
 * (/api/intent/commit). Every intent type reuses this one component.
 *
 * W95.4b — accepts intentOptions: IntentResult[] (length 1 or 2). Length 2 is
 * the disambiguation chooser: two buttons ("Capture as lead" / "Just add
 * contact"), each commits its own parsed fields. STAFFD voice — no vendor names.
 */

import { useEffect, useState } from "react";

export type IntentResult = { type: string; fields: Record<string, string>; confidence: number };

// Per-intent presentation: title + which fields to show + required gate + a
// short verb for the two-option chooser.
const INTENT_UI: Record<string, { title: string; required: string; verb: string; fields: { key: string; label: string }[] }> = {
  create_contact:     { title: "Add this contact?", required: "name", verb: "Just add contact", fields: [{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "context", label: "Context" }] },
  log_interaction:    { title: "Log this interaction?", required: "contact_name", verb: "Log interaction", fields: [{ key: "contact_name", label: "Who" }, { key: "interaction_type", label: "Type" }, { key: "notes", label: "Notes" }, { key: "occurred_at", label: "When" }] },
  schedule_followup:  { title: "Schedule this follow-up?", required: "contact_name", verb: "Schedule follow-up", fields: [{ key: "contact_name", label: "Who" }, { key: "due_date", label: "When" }, { key: "notes", label: "Notes" }] },
  add_to_email_list:  { title: "Add to your email list?", required: "email", verb: "Add to list", fields: [{ key: "email", label: "Email" }, { key: "name", label: "Name" }, { key: "list_name", label: "List" }] },
  create_task:        { title: "Add this task?", required: "title", verb: "Add task", fields: [{ key: "title", label: "Task" }, { key: "due_date", label: "Due" }, { key: "notes", label: "Notes" }] },
  capture_lead:       { title: "Capture this lead?", required: "name", verb: "Capture as lead", fields: [{ key: "name", label: "Name" }, { key: "company", label: "Company" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "interest_summary", label: "Interest" }, { key: "source", label: "Source" }] },
  update_contact:     { title: "Update this contact?", required: "contact_identifier", verb: "Update contact", fields: [{ key: "contact_identifier", label: "Contact" }, { key: "new_name", label: "New name" }, { key: "new_email", label: "New email" }, { key: "new_phone", label: "New phone" }, { key: "new_context", label: "New context" }] },
  log_expense:        { title: "Log this expense?", required: "amount", verb: "Log expense", fields: [{ key: "amount", label: "Amount" }, { key: "currency", label: "Currency" }, { key: "category", label: "Category" }, { key: "description", label: "Description" }, { key: "occurred_at", label: "When" }, { key: "client_name", label: "Client" }] },
  draft_campaign:     { title: "Have Marketing draft this?", required: "message_summary", verb: "Draft campaign", fields: [{ key: "message_summary", label: "What to say" }, { key: "subject_hint", label: "Subject idea" }, { key: "target_audience", label: "Audience" }, { key: "occasion", label: "Occasion" }] },
  send_for_signature: { title: "Send this for signature?", required: "document_identifier", verb: "Send for signature", fields: [{ key: "document_identifier", label: "Document" }, { key: "signer_name", label: "Signer" }, { key: "signer_email", label: "Signer email" }, { key: "notes", label: "Notes" }] },
  // UI-triggered (drawer reschedule) — not extracted.
  update_followup_status: { title: "Reschedule this follow-up?", required: "new_due_date", verb: "Reschedule", fields: [{ key: "new_due_date", label: "New date" }] },
};

const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", padding: "16px" };
const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "420px" };
const input: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", outline: "none", width: "100%" };

function uiFor(type: string, fields: Record<string, string>) {
  return INTENT_UI[type] ?? { title: "Confirm?", required: Object.keys(fields)[0] ?? "", verb: "Confirm", fields: Object.keys(fields).map((k) => ({ key: k, label: k })) };
}

export default function ConfirmActionModal({
  intentOptions,
  busy = false,
  onConfirm,
  onCancel,
}: {
  intentOptions: IntentResult[];
  busy?: boolean;
  onConfirm: (type: string, editedFields: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const single = intentOptions[0]!;
  const ui = uiFor(single.type, single.fields);
  const [fields, setFields] = useState<Record<string, string>>(single.fields);
  useEffect(() => setFields(single.fields), [single]);
  const canConfirm = !ui.required || !!(fields[ui.required] ?? "").trim();

  // ── Two-option disambiguation chooser ──
  if (intentOptions.length === 2) {
    const [a, b] = intentOptions;
    return (
      <div style={overlay} onClick={busy ? undefined : onCancel}>
        <div style={card} onClick={(e) => e.stopPropagation()}>
          <p className="font-semibold text-sm mb-1" style={{ color: "#F0F0F8" }}>A couple of ways to take that —</p>
          <p className="text-xs mb-4" style={{ color: "#7070A0" }}>Which did you mean? Pick one and your staff will handle it.</p>
          <div className="flex flex-col gap-2">
            {[a!, b!].map((opt) => {
              const oui = uiFor(opt.type, opt.fields);
              const preview = oui.fields.map((f) => opt.fields[f.key]).filter(Boolean).slice(0, 2).join(" · ");
              return (
                <button key={opt.type} disabled={busy} onClick={() => onConfirm(opt.type, opt.fields)}
                  className="text-left px-4 py-3 rounded-xl transition-colors" style={{ background: "#1A1A24", border: "1px solid #2A2A38" }}>
                  <span className="text-sm font-semibold" style={{ color: "#A07BFF" }}>{oui.verb}</span>
                  {preview && <span className="block text-xs mt-0.5" style={{ color: "#9090A8" }}>{preview}</span>}
                </button>
              );
            })}
          </div>
          <button disabled={busy} onClick={onCancel} className="mt-4 px-4 py-2 rounded-xl text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>Neither — never mind</button>
        </div>
      </div>
    );
  }

  // ── Single editable form ──
  return (
    <div style={overlay} onClick={busy ? undefined : onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-sm mb-1" style={{ color: "#F0F0F8" }}>{ui.title}</p>
        <p className="text-xs mb-4" style={{ color: "#7070A0" }}>Your staff caught this — check it over and confirm, or tweak anything that&apos;s off.</p>

        <div className="flex flex-col gap-2.5 mb-5">
          {ui.fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{f.label}</label>
              <input style={input} value={fields[f.key] ?? ""} placeholder={`Add ${f.label.toLowerCase()}…`}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button disabled={busy || !canConfirm} onClick={() => onConfirm(single.type, fields)}
            className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ opacity: busy || !canConfirm ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Confirm"}
          </button>
          <button disabled={busy} onClick={onCancel} className="px-4 py-2 rounded-xl text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
