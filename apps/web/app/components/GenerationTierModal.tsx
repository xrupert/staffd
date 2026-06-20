"use client";

/**
 * GenerationTierModal (W95.7.3d-T1) — the pre-generation tier picker. Three
 * radio rows (Quick / Pro / Premium), the department's recommended tier
 * pre-selected with "✓ recommended", credit cost per tier, and the customer's
 * current balance. On confirm it fires the actual generation with the chosen
 * tier. ZERO vendor names (tiers are universal; model slugs stay server-side).
 *
 * Credit cost is the LOCKED tier weight (pricing.TIER_WEIGHT) — shown
 * immediately, no estimate round-trip needed for display (W95.7.3d C-note:
 * the charge equals the selected tier's locked weight; the estimate endpoint
 * exists for catalog classification + USD transparency, not the displayed
 * credit cost). In-memory state only — no localStorage/cookie/URL.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import { TIERS, TIER_LABEL, TIER_DESC, tierWeight, defaultTierFor, type GenKind, type Tier } from "../api/_lib/generation/pricing";

export type GenerationRequest = { kind: GenKind; department: string; prompt: string };

const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", padding: "16px" };
const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "440px" };

export default function GenerationTierModal({
  pending,
  busy = false,
  onConfirm,
  onClose,
}: {
  pending: GenerationRequest | null;
  busy?: boolean;
  onConfirm: (tier: Tier) => void;
  onClose: () => void;
}) {
  const recommended: Tier = pending ? defaultTierFor(pending.department, pending.kind) : "pro";
  const [tier, setTier] = useState<Tier>(recommended);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => { if (pending) setTier(defaultTierFor(pending.department, pending.kind)); }, [pending]);
  useEffect(() => {
    if (!pending) return;
    void (async () => {
      try {
        const uid = pb.authStore.record?.id ?? "";
        const res = await fetch(`/api/credits?userId=${encodeURIComponent(uid)}`);
        if (res.ok) { const s = (await res.json()) as { totalRemaining?: Record<string, number> }; setBalance(s.totalRemaining?.[pending!.kind] ?? null); }
      } catch { setBalance(null); }
    })();
  }, [pending]);

  if (!pending) return null;
  const kind = pending.kind;
  const weight = tierWeight(kind, tier);

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-sm mb-1" style={{ color: "#F0F0F8" }}>Choose your quality</p>
        <p className="text-xs mb-4" style={{ color: "#7070A0" }}>Pick the tier — your specialist picks the best model and crafts the prompt.</p>

        <div className="flex flex-col gap-2 mb-4">
          {TIERS.map((t) => {
            const on = t === tier;
            return (
              <button key={t} onClick={() => setTier(t)} disabled={busy}
                className="text-left px-4 py-3 rounded-xl transition-colors flex items-start gap-3"
                style={{ background: on ? "rgba(91,33,232,0.12)" : "#1A1A24", border: `1px solid ${on ? "rgba(91,33,232,0.5)" : "#2A2A38"}` }}>
                <span aria-hidden className="mt-0.5" style={{ color: on ? "#A07BFF" : "#5A5A70" }}>{on ? "◉" : "○"}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold" style={{ color: on ? "#A07BFF" : "#F0F0F8" }}>
                      {TIER_LABEL[t]}{t === recommended ? <span style={{ color: "#22C55E", fontWeight: 600 }}> ✓ recommended</span> : null}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: "#9090A8" }}>{tierWeight(kind, t)} credit{tierWeight(kind, t) === 1 ? "" : "s"}</span>
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: "#7070A0" }}>{TIER_DESC[kind][t]}</span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-xs mb-4" style={{ color: balance != null && balance < weight ? "#F59E0B" : "#5A5A70" }}>
          {balance == null ? "" : `You have ${balance} ${kind} credit${balance === 1 ? "" : "s"} available.`}
        </p>

        <div className="flex items-center gap-2">
          <button disabled={busy} onClick={() => onConfirm(tier)}
            className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ opacity: busy ? 0.5 : 1 }}>
            {busy ? "Starting…" : `Confirm — ${TIER_LABEL[tier]} (${weight} credit${weight === 1 ? "" : "s"})`}
          </button>
          <button disabled={busy} onClick={onClose} className="px-4 py-2 rounded-xl text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
