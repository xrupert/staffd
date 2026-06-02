"use client";

/**
 * LowCreditsBanner — dismissible top-of-page warning when any credit
 * balance is running low (Phase 4).
 *
 * Dismissal is session-only (sessionStorage) so the banner returns on the
 * next visit if the situation hasn't been resolved by a top-up.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

type CreditState = {
  totalRemaining?: { image: number; video: number };
  agentCreditsTopup?: number;
};

const LOW_THRESHOLD = 10;
const DISMISS_KEY = "staffd_low_credits_dismissed_v1";

export default function LowCreditsBanner({ onTopUp }: { onTopUp?: () => void }) {
  const [shouldShow, setShouldShow] = useState(false);
  const [low, setLow] = useState<{ image: number; video: number; agent: number } | null>(null);

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
        const image = data.totalRemaining?.image ?? 0;
        const video = data.totalRemaining?.video ?? 0;
        const agent = data.agentCreditsTopup ?? 0;
        if (image < LOW_THRESHOLD || video < LOW_THRESHOLD || agent < LOW_THRESHOLD) {
          setLow({ image, video, agent });
          setShouldShow(true);
        }
      } catch { /* silent */ }
    })();
  }, []);

  if (!shouldShow || !low) return null;

  const lowList: string[] = [];
  if (low.image < LOW_THRESHOLD) lowList.push(`${low.image} image`);
  if (low.video < LOW_THRESHOLD) lowList.push(`${low.video} video`);
  if (low.agent < LOW_THRESHOLD) lowList.push(`${low.agent} agent`);

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
