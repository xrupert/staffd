"use client";

/**
 * Vault Insights panel (Phase 5).
 *
 * Surfaces the last 30 days of `vault_decisions` — real-world outcomes and
 * decisions fed by webhook receivers (Email Engine / E-Sign / CRM / Support
 * Inbox) plus any manual events logged via /api/vault/outcome.
 *
 * This is the user-facing view of the moat: the system shows them what
 * actually happened in the world (deals closed, contracts signed, emails
 * that landed) instead of just what their staff drafted.
 *
 * Brand: vendor names are NEVER shown to the user — only STAFFD-branded
 * functional labels. Swap a vendor later, UI stays unchanged.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

type DecisionRow = {
  id: string;
  decision_kind: string;
  title: string;
  source_kind?: string | null;
  document_id?: string | null;
  scope?: Record<string, unknown> | null;
  impact?: Record<string, unknown> | null;
  created: string;
};

// Brand rename — vendor names are an implementation detail, never shown to
// the user. These STAFFD-branded labels describe what the staff does with
// the service, not which SaaS sits behind it.
const SOURCE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  docuseal:  { label: "E-Sign",        color: "#22C55E", bg: "rgba(34,197,94,0.12)" },
  listmonk:  { label: "Email Engine",  color: "#0EA5E9", bg: "rgba(14,165,233,0.12)" },
  twenty:    { label: "CRM",           color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  plausible: { label: "Analytics",     color: "#A07BFF", bg: "rgba(160,123,255,0.12)" },
  chatwoot:  { label: "Support Inbox", color: "#EC4899", bg: "rgba(236,72,153,0.12)" },
  manual:    { label: "Logged",        color: "#9090A8", bg: "rgba(144,144,168,0.12)" },
};

const KIND_LABEL: Record<string, string> = {
  contract_signed:     "Contract signed",
  signature_declined:  "Signature declined",
  deal_closed:         "Deal won",
  meeting_booked:      "Meeting booked",
  content_published:   "Content published",
  outcome_observed:    "Outcome",
  strategic:           "Strategic call",
  manual:              "Logged",
};

function formatImpact(impact: Record<string, unknown> | null | undefined): string | null {
  if (!impact || typeof impact !== "object") return null;
  const metric = impact.metric as string | undefined;
  const value = impact.value;
  const currency = impact.currency as string | undefined;
  if (metric === "revenue" && typeof value === "number") {
    return currency && currency.toLowerCase() !== "usd"
      ? `${value.toLocaleString()} ${currency.toUpperCase()}`
      : `$${value.toLocaleString()}`;
  }
  if (metric === "email_open_rate" && typeof value === "number") {
    return `${(value * 100).toFixed(1)}% opens`;
  }
  if (metric === "email_click_rate" && typeof value === "number") {
    return `${(value * 100).toFixed(1)}% clicks`;
  }
  if (metric && value !== undefined) return `${metric}: ${String(value)}`;
  return null;
}

function relativeDate(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function VaultInsightsPanel() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) { setLoading(false); return; }
    void (async () => {
      try {
        // Read directly from PB with the user's session token — vault_decisions
        // is the user's own data and PB row rules enforce scope.
        const res = await pb.collection("vault_decisions").getList(1, 25, {
          filter: `user = '${userId}' && dismissed != true`,
          sort: "-created",
        });
        setRows(res.items as unknown as DecisionRow[]);
      } catch {
        // Collection may not exist yet pre-Phase-5 setup — render empty state.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <section
        className="rounded-2xl p-6 mt-6"
        style={{ background: "#111118", border: "1px solid #2A2A38" }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Insights</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section
        className="rounded-2xl p-6 mt-6"
        style={{ background: "#111118", border: "1px solid #2A2A38" }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Insights</h2>
        <p className="text-xs leading-relaxed" style={{ color: "#9090A8" }}>
          As your staff sends emails, books meetings, and gets contracts signed, the results
          roll up here — deals won, content published, customers replied to. Your CEO uses
          these to set weekly priorities instead of guessing.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl p-6 mt-6"
      style={{ background: "#111118", border: "1px solid #2A2A38" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Insights</h2>
          <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>
            Real-world outcomes — last 30 days
          </p>
        </div>
        <span className="text-xs" style={{ color: "#5A5A70" }}>{rows.length} event{rows.length === 1 ? "" : "s"}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const badge = r.source_kind ? SOURCE_BADGE[r.source_kind] ?? SOURCE_BADGE.manual : null;
          const kindLabel = KIND_LABEL[r.decision_kind] ?? r.decision_kind;
          const impactStr = formatImpact(r.impact);
          return (
            <li
              key={r.id}
              className="rounded-xl px-4 py-3 flex items-start gap-3"
              style={{ background: "#0D0D16", border: "1px solid #1E1E2A" }}
            >
              {badge && (
                <span
                  className="text-xs px-2 py-0.5 rounded-md flex-shrink-0 mt-0.5"
                  style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.color}30` }}
                >
                  {badge.label}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-semibold" style={{ color: "#A07BFF" }}>
                    {kindLabel}
                  </span>
                  <span className="text-xs flex-shrink-0" style={{ color: "#5A5A70" }}>
                    {relativeDate(r.created)}
                  </span>
                </div>
                <p className="text-sm mt-1" style={{ color: "#F0F0F8", lineHeight: 1.5 }}>
                  {r.title}
                </p>
                {impactStr && (
                  <p className="text-xs mt-1" style={{ color: "#22C55E", fontWeight: 600 }}>
                    {impactStr}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
