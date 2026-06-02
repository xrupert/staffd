"use client";

/**
 * CreditsWidget — dashboard credit balance card (Phase 4).
 *
 * Surfaces image / video / agent credit balances + "Top up" CTA that opens
 * the TopupModal. Re-fetches on visibility change so a successful Stripe
 * checkout (which redirects back to /dashboard?topup=success) shows the
 * updated balance immediately.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";
import TopupModal from "./TopupModal";

type CreditState = {
  plan?: string;
  monthlyAllowance?: { image: number; video: number };
  monthlyRemaining?: { image: number; video: number };
  totalRemaining?: { image: number; video: number };
  topupBalance?: { image: number; video: number };
  agentCreditsTopup?: number;
  ceoAddonActive?: boolean;
};

const LOW_THRESHOLD = 10;

export default function CreditsWidget() {
  const [state, setState] = useState<CreditState | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);

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

  const image = state.totalRemaining?.image ?? 0;
  const video = state.totalRemaining?.video ?? 0;
  const agent = state.agentCreditsTopup ?? 0;
  const anyLow = image < LOW_THRESHOLD || video < LOW_THRESHOLD || agent < LOW_THRESHOLD;

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
              {state.plan ? `${state.plan.charAt(0).toUpperCase()}${state.plan.slice(1)} plan` : "Plan"}
              {state.ceoAddonActive ? " · CEO add-on" : ""}
            </p>
          </div>
          <button
            onClick={() => setTopupOpen(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white btn-primary"
          >
            Top up
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <CreditTile label="Images" value={image} />
          <CreditTile label="Videos" value={video} />
          <CreditTile label="Agent" value={agent} subtle={agent === 0} />
        </div>

        {anyLow && (
          <p className="text-xs mt-3" style={{ color: "#F59E0B" }}>
            One or more balances are running low. Top up to keep generating.
          </p>
        )}
      </section>

      <TopupModal open={topupOpen} onClose={() => setTopupOpen(false)} />
    </>
  );
}

function CreditTile({ label, value, subtle }: { label: string; value: number; subtle?: boolean }) {
  const isLow = value < LOW_THRESHOLD;
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "#1A1A24",
        border: `1px solid ${isLow ? "rgba(245,158,11,0.25)" : "#2A2A38"}`,
      }}
    >
      <div
        className="text-2xl font-bold"
        style={{ color: subtle ? "#5A5A70" : isLow ? "#F59E0B" : "#F0F0F8" }}
      >
        {value.toLocaleString()}
      </div>
      <div className="text-xs mt-0.5" style={{ color: "#7070A0" }}>{label}</div>
    </div>
  );
}
