"use client";

/**
 * IntentActionModal (W95.7.1) — a thin wrapper that lets a one-click action
 * button reuse the conversational confirm-to-commit path. A button pre-fills an
 * intent + fields, this renders the shared ConfirmActionModal (so the user
 * still reviews/edits/confirms — never a silent vendor write), and on confirm
 * fires the SAME /api/intent/commit the text/voice path uses.
 *
 * Used by DepartmentRoom (which has no inline intent flow). CommandCenter keeps
 * its richer inline flow (graduation offers / undo) and just calls
 * setPendingIntents directly.
 */

import { useState } from "react";
import pb from "../../lib/pb";
import ConfirmActionModal from "./ConfirmActionModal";

export type PendingAction = { type: string; fields: Record<string, string> };

export default function IntentActionModal({
  pending,
  onClose,
  onResult,
}: {
  pending: PendingAction | null;
  onClose: () => void;
  onResult: (message: string, ok: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!pending) return null;

  async function confirm(type: string, fields: Record<string, string>) {
    setBusy(true);
    try {
      const res = await fetch("/api/intent/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ intent_type: type, fields, source: "ui", edited: false }),
      });
      const ok = res.ok;
      const data = ok ? ((await res.json().catch(() => ({}))) as { expected_completion_message?: string }) : {};
      onResult(ok ? (data.expected_completion_message ?? "Done — your staff have it.") : "Couldn't save that just now — give it another try.", ok);
    } catch {
      onResult("Couldn't save that just now — give it another try.", false);
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <ConfirmActionModal
      intentOptions={[{ type: pending.type, fields: pending.fields, confidence: 1 }]}
      busy={busy}
      onConfirm={(t, f) => void confirm(t, f)}
      onCancel={() => { if (!busy) onClose(); }}
    />
  );
}
