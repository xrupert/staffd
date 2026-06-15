"use client";

/**
 * ActionRecipientModal (FC-2b) — collects a recipient name + email for the
 * two integration actions that need one: "Open support ticket" (Chatwoot
 * customer) and "Send for signature" (Docuseal signer). The artifact itself
 * is the content; only the recipient is missing, so this is a tiny two-field
 * confirm step before the write fires.
 */

import { useEffect, useState } from "react";

export type RecipientKind = "support" | "signature";

const COPY: Record<RecipientKind, { title: string; cta: string; nameLabel: string; emailLabel: string; hint: string }> = {
  support: {
    title: "Open a support ticket",
    cta: "Open ticket →",
    nameLabel: "Customer name",
    emailLabel: "Customer email",
    hint: "Creates a conversation in your support inbox with this reply as the first message.",
  },
  signature: {
    title: "Send for signature",
    cta: "Send for signature →",
    nameLabel: "Signer name",
    emailLabel: "Signer email",
    hint: "Sends this document to the signer for e-signature. They'll get an email with a signing link.",
  },
};

type Props = {
  open: boolean;
  kind: RecipientKind;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (recipient: { name: string; email: string }) => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ActionRecipientModal({ open, kind, busy, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // Reset fields whenever the modal (re)opens.
  useEffect(() => {
    if (open) { setName(""); setEmail(""); }
  }, [open, kind]);

  if (!open) return null;
  const copy = COPY[kind];
  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = !busy && emailValid;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(9,9,15,0.7)" }}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-1" style={{ color: "#F0F0F8" }}>{copy.title}</h3>
        <p className="text-xs mb-5" style={{ color: "#7070A0", lineHeight: 1.5 }}>{copy.hint}</p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{copy.nameLabel}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{copy.emailLabel}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) onSubmit({ name: name.trim(), email: email.trim() }); }}
              placeholder="jane@company.com"
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={() => { if (!busy) onClose(); }}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#5A5A70", background: "none", border: "none", cursor: busy ? "not-allowed" : "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ name: name.trim(), email: email.trim() })}
            disabled={!canSubmit}
            className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ opacity: canSubmit ? 1 : 0.4, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            {busy ? "Sending…" : copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
