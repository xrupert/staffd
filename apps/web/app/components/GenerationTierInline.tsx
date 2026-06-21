"use client";

/**
 * GenerationTierInline (W95.7.3d-h2) — the pre-generation tier gate rendered
 * INLINE in the CommandCenter conversation stream, NOT as an overlay modal
 * (ratified D2(a)). Same behavior + same data as GenerationTierModal — both
 * render from the shared `buildTierOptions` source (Standard #2), so tiers,
 * locked weights, recommended default, labels and descriptions are identical;
 * only the container differs (an in-thread block vs a fixed overlay card).
 *
 * Why inline: in a chat surface a full-screen overlay yanks the user out of the
 * thread they are reading. Rendering the picker where the specialist's "want me
 * to generate this?" prompt already sits keeps spatial + interaction continuity
 * with the existing inline affordances (chips, IntentActionModal). In-memory
 * state only — no localStorage/cookie/URL. ZERO vendor names.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import { type Tier } from "../api/_lib/generation/pricing";
import { buildTierOptions, type GenerationRequest } from "../api/_lib/generation/tier-options";

export type { GenerationRequest };

const block: React.CSSProperties = { background: "#14141C", border: "1px solid #2A2A38", borderRadius: "14px", padding: "16px", maxWidth: "440px" };

export default function GenerationTierInline({
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
  const opts = pending ? buildTierOptions(pending.department, pending.kind) : null;
  const [tier, setTier] = useState<Tier>(opts?.recommended ?? "pro");
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => { if (pending) setTier(buildTierOptions(pending.department, pending.kind).recommended); }, [pending]);
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

  if (!pending || !opts) return null;
  const kind = pending.kind;
  const weight = opts.rows.find((r) => r.tier === tier)?.weight ?? opts.rows[0]!.weight;

  return (
    <div style={block}>
      <p className="font-semibold text-sm mb-1" style={{ color: "#F0F0F8" }}>Choose your quality</p>
      <p className="text-xs mb-3" style={{ color: "#7070A0" }}>Pick the tier — your specialist picks the best model and crafts the prompt.</p>

      <div className="flex flex-col gap-2 mb-3">
        {opts.rows.map((r) => {
          const on = r.tier === tier;
          return (
            <button key={r.tier} onClick={() => setTier(r.tier)} disabled={busy}
              className="text-left px-4 py-3 rounded-xl transition-colors flex items-start gap-3"
              style={{ background: on ? "rgba(91,33,232,0.12)" : "#1A1A24", border: `1px solid ${on ? "rgba(91,33,232,0.5)" : "#2A2A38"}` }}>
              <span aria-hidden className="mt-0.5" style={{ color: on ? "#A07BFF" : "#5A5A70" }}>{on ? "◉" : "○"}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: on ? "#A07BFF" : "#F0F0F8" }}>
                    {r.label}{r.recommended ? <span style={{ color: "#22C55E", fontWeight: 600 }}> ✓ recommended</span> : null}
                  </span>
                  <span className="text-xs flex-shrink-0" style={{ color: "#9090A8" }}>{r.weight} credit{r.weight === 1 ? "" : "s"}</span>
                </span>
                <span className="block text-xs mt-0.5" style={{ color: "#7070A0" }}>{r.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs mb-3" style={{ color: balance != null && balance < weight ? "#F59E0B" : "#5A5A70" }}>
        {balance == null ? "" : `You have ${balance} ${kind} credit${balance === 1 ? "" : "s"} available.`}
      </p>

      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={() => onConfirm(tier)}
          className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ opacity: busy ? 0.5 : 1 }}>
          {busy ? "Starting…" : `Confirm — ${opts.rows.find((r) => r.tier === tier)?.label ?? tier} (${weight} credit${weight === 1 ? "" : "s"})`}
        </button>
        <button disabled={busy} onClick={onClose} className="px-4 py-2 rounded-xl text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>Cancel</button>
      </div>
    </div>
  );
}
