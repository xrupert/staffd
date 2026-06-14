"use client";

/**
 * CreditsWidget — dashboard credit balance card (Phase 4, reshaped T3.0).
 *
 * Per ARCH §12 credits exist for IMAGES and VIDEOS only — specialist
 * conversations are unlimited, so no agent counter is ever rendered here
 * (the API may still emit agentCreditsTopup; it stays invisible).
 * "Top up" CTA opens the existing TopupModal when a balance runs low.
 * Re-fetches on visibility change so a successful Stripe checkout (which
 * redirects back to /dashboard?topup=success) shows the updated balance
 * immediately.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";
import { useEffectivePlan, type Plan } from "../../lib/hooks/useEffectivePlan";
import TopupModal from "./TopupModal";

type CreditState = {
  plan?: string;
  monthlyAllowance?: { image: number; video: number };
  monthlyRemaining?: { image: number; video: number };
  totalRemaining?: { image: number; video: number };
  topupBalance?: { image: number; video: number };
  ceoAddonActive?: boolean;
};

// T3.0 — Top-up CTA thresholds per SA spec: image < 20%, video < 30%.
const IMAGE_LOW_RATIO = 0.2;
const VIDEO_LOW_RATIO = 0.3;

// W46 interim — comp accounts inferred client-side from the 100×-Agency
// allowance shape until the API exposes a `comped` boolean.
function isCompState(state: CreditState): boolean {
  return state.plan === "agency" && (state.monthlyAllowance?.image ?? 0) >= 5000;
}

export default function CreditsWidget() {
  const [state, setState] = useState<CreditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);
  const effectivePlan = useEffectivePlan((state?.plan ?? null) as Plan | null);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/credits?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = (await res.json()) as CreditState;
        setState(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  if (loading || !state) {
    return (
      <section
        className="rounded-2xl p-5"
        style={{ background: "#111118", border: "1px solid #2A2A38" }}
      >
        <div className="text-xs" style={{ color: "#5A5A70" }}>Loading credits…</div>
      </section>
    );
  }

  const comp = isCompState(state);
  const imageAllowance = state.monthlyAllowance?.image ?? 0;
  const videoAllowance = state.monthlyAllowance?.video ?? 0;
  const imageRemaining = state.totalRemaining?.image ?? 0;
  const videoRemaining = state.totalRemaining?.video ?? 0;
  const imageTopup = state.topupBalance?.image ?? 0;
  const videoTopup = state.topupBalance?.video ?? 0;

  const imageLow = !comp && (imageAllowance > 0 ? imageRemaining / imageAllowance < IMAGE_LOW_RATIO : true);
  const videoLow = !comp && (videoAllowance > 0 ? videoRemaining / videoAllowance < VIDEO_LOW_RATIO : true);
  const showTopup = !comp && (imageLow || videoLow);

  return (
    <>
      <section
        className="rounded-2xl p-5"
        style={{ background: "#111118", border: "1px solid #2A2A38" }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold mb-0.5" style={{ color: "#F0F0F8" }}>
              Credits
            </h3>
            <p className="text-xs" style={{ color: "#5A5A70" }}>
              {effectivePlan ? `${effectivePlan.charAt(0).toUpperCase()}${effectivePlan.slice(1)} plan` : "Plan"}
              {state.ceoAddonActive ? " · CEO add-on" : ""}
            </p>
          </div>
          {showTopup && (
            <button
              onClick={() => setTopupOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-primary"
            >
              Top up
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CreditTile
            label="images"
            remaining={imageRemaining}
            allowance={imageAllowance}
            topup={imageTopup}
            low={imageLow}
            unlimited={comp}
          />
          <CreditTile
            label="videos"
            remaining={videoRemaining}
            allowance={videoAllowance}
            topup={videoTopup}
            low={videoLow}
            unlimited={comp}
          />
        </div>

        {showTopup && (
          <p className="text-xs mt-3" style={{ color: "#F59E0B" }}>
            One or more balances are running low. Top up to keep generating.
          </p>
        )}
      </section>

      <TopupModal open={topupOpen} onClose={() => setTopupOpen(false)} />
    </>
  );
}

function CreditTile({
  label,
  remaining,
  allowance,
  topup,
  low,
  unlimited,
}: {
  label: string;
  remaining: number;
  allowance: number;
  topup: number;
  low: boolean;
  unlimited: boolean;
}) {
  return (
    <div
      data-testid="credit-tile"
      className="rounded-xl p-3"
      style={{
        background: "#1A1A24",
        border: `1px solid ${low ? "rgba(245,158,11,0.25)" : "#2A2A38"}`,
      }}
      title={unlimited ? undefined : `of ${allowance.toLocaleString()} monthly + ${topup.toLocaleString()} top-up`}
    >
      <div
        className="text-lg font-bold"
        style={{ color: low ? "#F59E0B" : "#F0F0F8" }}
      >
        {unlimited ? "Unlimited" : `${remaining.toLocaleString()} left this month`}
      </div>
      <div className="text-xs mt-0.5" style={{ color: "#7070A0" }}>{label}</div>
    </div>
  );
}
