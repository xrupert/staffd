"use client";

/**
 * TopupModal — Cinema-pack purchase modal (PR-Paddle-A, value-priced model).
 *
 * SA 2026-07-29: the six legacy image/video credit packs are gone. The one
 * purchasable top-up is Cinema extension packs — extra cinematic clips for
 * the month (+10/$39, +30/$99). Clicking a pack POSTs to
 * `/api/billing/checkout-topup`; the response opens the payment overlay
 * (or redirects, provider-dependent). The webhook credits
 * `cinema_pack_topups` on success.
 */

import { useState } from "react";
import pb from "../../lib/pb";
import { followCheckout, BILLING_NOT_CONFIGURED_MSG } from "../../lib/paddle-client";

type Pack = { id: string; clips: number; priceCents: number; note: string };

const CINEMA_PACKS: Pack[] = [
  { id: "cinema-10", clips: 10, priceCents: 3900, note: "About one extra 30-second commercial" },
  { id: "cinema-30", clips: 30, priceCents: 9900, note: "Nearly four extra commercials — best value" },
];

function dollarStr(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function TopupModal({ open, onClose }: Props) {
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function buyPack(pack: string) {
    setLoadingPack(pack);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ pack }),
      });
      const data = await res.json();
      const outcome = await followCheckout(data);
      if (outcome === "not_configured") {
        setError(BILLING_NOT_CONFIGURED_MSG);
        setLoadingPack(null);
      } else if (outcome === "error") {
        setError(data.error ?? "checkout_failed");
        setLoadingPack(null);
      } else if (outcome === "opened") {
        setLoadingPack(null);
      }
    } catch {
      setError("network_error");
      setLoadingPack(null);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-2xl overflow-hidden anim-modal"
        style={{ background: "#111118", border: "1px solid #2A2A38" }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "#F0F0F8" }}>Extend this month&apos;s cinematic allowance</h2>
            <p className="text-xs mt-0.5" style={{ color: "#7A7A95" }}>
              Cinema packs add premium cinematic clips on top of your plan&apos;s monthly allowance.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#7A7A95" }}
          >
            Close
          </button>
        </div>

        {/* Cinema packs */}
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CINEMA_PACKS.map((p) => {
              const isLoading = loadingPack === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => void buyPack(p.id)}
                  disabled={loadingPack !== null}
                  className="text-left p-4 rounded-xl transition-all"
                  style={{
                    background: "#1A1A24",
                    border: "1px solid #2A2A38",
                    cursor: loadingPack !== null ? "wait" : "pointer",
                    opacity: loadingPack !== null && !isLoading ? 0.4 : 1,
                  }}
                >
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="text-lg font-bold" style={{ color: "#F0F0F8" }}>
                      +{p.clips} clips
                    </div>
                    <div className="text-sm font-semibold" style={{ color: "#A07BFF" }}>
                      {dollarStr(p.priceCents)}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: "#7070A0" }}>
                    {p.note}
                  </div>
                  {isLoading && (
                    <div className="text-xs mt-2" style={{ color: "#A07BFF" }}>
                      Opening checkout…
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="px-6 pb-4">
            <p className="text-xs" style={{ color: "#EF4444" }}>
              Couldn&apos;t open checkout: {error}
            </p>
          </div>
        )}

        <div className="px-6 py-3 text-xs" style={{ borderTop: "1px solid #1E1E2A", color: "#7A7A95" }}>
          Payment processed securely. Clips apply the moment payment completes.
        </div>
      </div>
    </div>
  );
}
