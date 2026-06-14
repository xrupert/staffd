"use client";

/**
 * LowCreditsBanner — dismissible top-of-page warning when the image or
 * video credit balance is running low (Phase 4, reshaped T3.0).
 *
 * Per ARCH §12 credits exist for IMAGES and VIDEOS only — no agent counter
 * is tracked or displayed. Comp accounts (100× Agency allowance) never see
 * this banner per the §12 hard rule: comp users never see "out of credits."
 *
 * Dismissal is session-only (sessionStorage) so the banner returns on the
 * next visit if the situation hasn't been resolved by a top-up.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import { useEffectivePlan, type Plan } from "../../lib/hooks/useEffectivePlan";

type CreditState = {
  plan?: string;
  monthlyAllowance?: { image: number; video: number };
  totalRemaining?: { image: number; video: number };
};

const LOW_THRESHOLD = 10;
const DISMISS_KEY = "staffd_low_credits_dismissed_v1";

export default function LowCreditsBanner({ onTopUp }: { onTopUp?: () => void }) {
  const [shouldShow, setShouldShow] = useState(false);
  const [low, setLow] = useState<{ image: number; video: number } | null>(null);
  const [realPlan, setRealPlan] = useState<string | null>(null);
  const effectivePlan = useEffectivePlan(realPlan as Plan | null);

  useEffect(() => {
    const dismissed = typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1";
    if (dismissed) return;

    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;

    void (async () => {
      try {
        const res = await fetch(`/api/credits?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as CreditState;
        setRealPlan(data.plan ?? null);
        // W46 interim — comp inference from the 100×-Agency allowance shape.
        // Comp users never see "out of credits" (ARCH §12 hard rule).
        if (data.plan === "agency" && (data.monthlyAllowance?.image ?? 0) >= 5000) return;
        const image = data.totalRemaining?.image ?? 0;
        const video = data.totalRemaining?.video ?? 0;
        if (image < LOW_THRESHOLD || video < LOW_THRESHOLD) {
          setLow({ image, video });
          setShouldShow(true);
        }
      } catch { /* silent */ }
    })();
  }, []);

  if (!shouldShow || !low || effectivePlan === "agency") return null;

  const lowList: string[] = [];
  if (low.image < LOW_THRESHOLD) lowList.push(`${low.image} image`);
  if (low.video < LOW_THRESHOLD) lowList.push(`${low.video} video`);

  return (
    <div
      className="rounded-xl px-4 py-3 mb-5 flex items-center gap-3"
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.25)",
      }}
    >
      <span style={{ fontSize: "16px" }}>⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs" style={{ color: "#F0F0F8", lineHeight: 1.5 }}>
          Low on credits — {lowList.join(", ")} remaining. Top up to keep your staff working.
        </p>
      </div>
      <button
        onClick={() => onTopUp?.()}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-primary"
      >
        Top up
      </button>
      <button
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, "1");
          setShouldShow(false);
        }}
        className="text-xs transition-colors hover:text-white"
        style={{ color: "#9090A8" }}
      >
        Dismiss
      </button>
    </div>
  );
}
