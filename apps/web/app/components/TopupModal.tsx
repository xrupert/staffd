"use client";

/**
 * TopupModal — credit-pack purchase modal (W47, §3-aligned).
 *
 * Six SKUs match ARCH §3: three image packs, three video packs. Prices
 * match the configured price ids. Clicking a pack POSTs to
 * `/api/billing/checkout-topup`, which returns a provider-hosted checkout
 * URL; we redirect to it. The webhook credits the matching bucket (image or
 * video — ARCH §12) on success and the dashboard widget re-fetches.
 */

import { useState } from "react";
import pb from "../../lib/pb";

type Pack = { id: string; type: "image" | "video"; count: number; priceCents: number };

const IMAGE_PACKS: Pack[] = [
  { id: "topup-img-50",  type: "image", count: 50,  priceCents:   999 },
  { id: "topup-img-150", type: "image", count: 150, priceCents:  2499 },
  { id: "topup-img-350", type: "image", count: 350, priceCents:  5499 },
];

const VIDEO_PACKS: Pack[] = [
  { id: "topup-vid-10",  type: "video", count: 10,  priceCents:  2299 },
  { id: "topup-vid-25",  type: "video", count: 25,  priceCents:  5499 },
  { id: "topup-vid-50",  type: "video", count: 50,  priceCents: 10999 },
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
      const res = await fetch("/api/billing/checkout-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ userId, userEmail, pack }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error === "billing_not_configured" ? "Billing isn't connected yet — check back soon." : (data.error ?? "checkout_failed"));
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

        {/* Packs — grouped by credit type per ARCH §12 (image / video only) */}
        <div className="p-6 flex flex-col gap-5">
          {[
            { label: "Image credits", packs: IMAGE_PACKS },
            { label: "Video credits", packs: VIDEO_PACKS },
          ].map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold mb-2" style={{ color: "#7070A0" }}>
                {group.label}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {group.packs.map((p) => {
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
                          {p.count.toLocaleString()}
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "#A07BFF" }}>
                          {dollarStr(p.priceCents)}
                        </div>
                      </div>
                      <div className="text-xs" style={{ color: "#7070A0" }}>
                        {p.count} {p.type} credits — {dollarStr(p.priceCents)}
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
          ))}
        </div>

        {error && (
          <div className="px-6 pb-4">
            <p className="text-xs" style={{ color: "#EF4444" }}>
              Couldn't open checkout: {error}
            </p>
          </div>
        )}

        <div className="px-6 py-3 text-xs" style={{ borderTop: "1px solid #1E1E2A", color: "#5A5A70" }}>
          Payment processed securely. You'll be redirected.
        </div>
      </div>
    </div>
  );
}
