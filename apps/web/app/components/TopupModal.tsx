"use client";

/**
 * TopupModal — credit-pack purchase modal (Phase 4).
 *
 * Six SKUs match the locked spec (100 / 250 / 500 / 1000 / 2500 / 5000).
 * Prices match `/api/setup/stripe`. Clicking a pack POSTs to
 * `/api/stripe/checkout-topup`, which returns a Stripe Checkout URL; we
 * redirect to it. The webhook credits the user on success and the dashboard
 * widget re-fetches.
 */

import { useState } from "react";
import pb from "../../lib/pb";

const PACKS = [
  { id: "topup-100",  credits:  100, priceCents:   999, perCredit: 0.099 },
  { id: "topup-250",  credits:  250, priceCents:  1999, perCredit: 0.080 },
  { id: "topup-500",  credits:  500, priceCents:  3499, perCredit: 0.070 },
  { id: "topup-1000", credits: 1000, priceCents:  5999, perCredit: 0.060 },
  { id: "topup-2500", credits: 2500, priceCents: 12999, perCredit: 0.052 },
  { id: "topup-5000", credits: 5000, priceCents: 22999, perCredit: 0.046 },
];

function dollarStr(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
      const userId = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string | undefined) ?? "";
      const res = await fetch("/api/stripe/checkout-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, userEmail, pack }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "checkout_failed");
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
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ background: "#111118", border: "1px solid #2A2A38" }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "#F0F0F8" }}>Top up credits</h2>
            <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>
              Credits never expire. Bigger packs cost less per credit.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#5A5A70" }}
          >
            Close
          </button>
        </div>

        {/* Grid */}
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PACKS.map((p) => {
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
                    {p.credits.toLocaleString()}
                  </div>
                  <div className="text-sm font-semibold" style={{ color: "#A07BFF" }}>
                    {dollarStr(p.priceCents)}
                  </div>
                </div>
                <div className="text-xs" style={{ color: "#7070A0" }}>
                  credits · {dollarStr(Math.round(p.perCredit * 100))}/credit
                </div>
                {isLoading && (
                  <div className="text-xs mt-2" style={{ color: "#A07BFF" }}>
                    Opening Stripe…
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="px-6 pb-4">
            <p className="text-xs" style={{ color: "#EF4444" }}>
              Couldn't open checkout: {error}
            </p>
          </div>
        )}

        <div className="px-6 py-3 text-xs" style={{ borderTop: "1px solid #1E1E2A", color: "#5A5A70" }}>
          Payment processed by Stripe. You'll be redirected.
        </div>
      </div>
    </div>
  );
}
