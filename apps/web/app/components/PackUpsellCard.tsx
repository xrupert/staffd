"use client";

/**
 * PackUpsellCard (Phase 9).
 *
 * Contextual industry-pack upsell. Pattern-matches the user's `vault.industry`
 * against pack id signals and surfaces a single inline card when a matching
 * pack is INACTIVE. Silent when no signal matches or the pack is already on.
 *
 * Mounted in dept rooms so the upsell appears in context — e.g., a Real
 * Estate user lands in Marketing and sees "Get the Real Estate Pack — adds
 * a Listing Promoter to your Marketing room."
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

type PackCatalogEntry = {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentCount: number;
  departments: string[];
  active: boolean;
};

// Signal → pack id. Loose keyword match against vault.industry.
const INDUSTRY_SIGNALS: Array<{ pack: string; pattern: RegExp }> = [
  { pack: "law",          pattern: /\b(law|legal|attorney|lawyer|litigation|paralegal)\b/i },
  { pack: "real-estate",  pattern: /\b(real estate|realtor|broker(age)?|property|listing)\b/i },
  { pack: "restaurants",  pattern: /\b(restaurant|cafe|caf[eé]|bar|bistro|food service|catering|hospitality)\b/i },
  { pack: "coaches",      pattern: /\b(coach|coaching)\b/i },
  { pack: "trades",       pattern: /\b(plumb|electric|hvac|roofing|contractor|handyman|trade|construction)\b/i },
  { pack: "salons",       pattern: /\b(salon|barber|stylist|hair|beauty|spa|esthetician|nails)\b/i },
  { pack: "agencies",     pattern: /\b(agency|agencies|marketing agency|design agency|dev agency|creative agency)\b/i },
  { pack: "consultants",  pattern: /\b(consult|consulting|consultant|advisor|advisory)\b/i },
];

function inferPackFromIndustry(industry: string | undefined): string | null {
  if (!industry) return null;
  for (const sig of INDUSTRY_SIGNALS) {
    if (sig.pattern.test(industry)) return sig.pack;
  }
  return null;
}

const DISMISS_KEY_PREFIX = "staffd_pack_upsell_dismissed_v1:";

type Props = {
  /** Department room this upsell is rendering inside. Card silently hides if
   *  the inferred pack doesn't include a specialist for this dept. */
  department: string;
};

export default function PackUpsellCard({ department }: Props) {
  const [pack, setPack] = useState<PackCatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;

    void (async () => {
      try {
        // Fetch vault to read industry
        const vaultRes = await pb.collection("businesses").getList(1, 1, {
          filter: `user = '${userId}'`,
          fields: "industry",
        });
        const industry = (vaultRes.items[0]?.industry as string | undefined) ?? "";
        const inferred = inferPackFromIndustry(industry);
        if (!inferred) return;

        // Dismiss check
        if (sessionStorage.getItem(DISMISS_KEY_PREFIX + inferred) === "1") return;

        // Fetch pack catalog + active state
        const packsRes = await fetch(`/api/packs?userId=${encodeURIComponent(userId)}`);
        if (!packsRes.ok) return;
        const data = await packsRes.json();
        const target = (data.packs as PackCatalogEntry[]).find((p) => p.id === inferred);
        if (!target) return;
        if (target.active) return;
        // Only surface when the inferred pack actually has a specialist in
        // this department — keeps the upsell contextually relevant.
        if (!target.departments.includes(department)) return;
        setPack(target);
      } catch {
        /* silent */
      }
    })();
  }, [department]);

  if (!pack) return null;

  async function buy() {
    if (!pack) return;
    setBusy(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string | undefined) ?? "";
      const res = await fetch("/api/stripe/checkout-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, userEmail, packId: pack.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  function dismiss() {
    if (!pack) return;
    sessionStorage.setItem(DISMISS_KEY_PREFIX + pack.id, "1");
    setPack(null);
  }

  return (
    <div
      className="rounded-xl px-4 py-3 mb-4 flex items-start gap-3"
      style={{ background: "rgba(91,33,232,0.06)", border: "1px solid rgba(91,33,232,0.25)" }}
    >
      <span style={{ fontSize: "22px" }}>{pack.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>
          Sharper {departmentLabel(department)} with the {pack.name}
        </p>
        <p className="text-xs mt-1" style={{ color: "#9090A8" }}>
          {pack.description}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => void buy()}
            disabled={busy}
            className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ opacity: busy ? 0.5 : 1 }}
          >
            {busy ? "Opening Stripe…" : "Add — $19/mo"}
          </button>
          <button
            onClick={dismiss}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#5A5A70" }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function departmentLabel(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).replace("-", " ");
}
