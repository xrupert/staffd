"use client";

/**
 * VaultEditor — Settings → "Your business" section (W50, D-21 substrate).
 *
 * Manual edit surface for the expanded business profile: brand voice,
 * customer/market context, operations, and reputation numbers. Every
 * field optional (Decision 6); categories are visual only — the schema
 * stays flat (Decision 5). Saves via the canonical client-side PB write
 * (Decision 7, same pattern as onboarding / the W59 industry edit).
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import { isSuperAdminClient } from "../../lib/hooks/useEffectivePlan";

type FieldDef = { name: string; label: string; multiline?: boolean; placeholder?: string };

const CATEGORIES: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: "Brand & Voice",
    fields: [
      { name: "brand_voice", label: "Brand voice", placeholder: "Direct and confident, no jargon" },
      { name: "brand_tone", label: "Brand tone", placeholder: "Friendly but professional" },
      { name: "brand_visuals", label: "Brand visuals", multiline: true, placeholder: "Colors, typography, links to assets" },
      { name: "messaging_pillars", label: "Messaging pillars", multiline: true, placeholder: "The 3–5 themes your brand owns" },
      { name: "hard_nos", label: "Hard nos", multiline: true, placeholder: "What your staff never says, does, or claims" },
    ],
  },
  {
    title: "Customer & Market",
    fields: [
      { name: "customer_profile", label: "Customer profile", multiline: true, placeholder: "Who buys, why they buy, how they decide" },
      { name: "positioning", label: "Positioning", multiline: true, placeholder: "How you're different from the competition" },
      { name: "service_area", label: "Service area", placeholder: "Cities, zips, regions you serve" },
    ],
  },
  {
    title: "Operations",
    fields: [
      { name: "avg_ticket", label: "Average ticket", placeholder: "Typical job size or revenue range" },
      { name: "lead_sources", label: "Lead sources", placeholder: "Where customers come from today" },
      { name: "seasonality", label: "Seasonality & capacity", multiline: true, placeholder: "Peak and slow periods, capacity limits" },
    ],
  },
  {
    title: "Reputation",
    fields: [
      { name: "review_count", label: "Review count", placeholder: "e.g. 132" },
      { name: "review_rating", label: "Review rating (0–5)", placeholder: "e.g. 4.7" },
      { name: "review_platform", label: "Review platform", placeholder: "Google, Yelp, Houzz…" },
    ],
  },
];

const ALL_FIELD_NAMES = CATEGORIES.flatMap((c) => c.fields.map((f) => f.name));
const NUMBER_FIELDS = new Set(["review_count", "review_rating"]);

/** Parse + validate a number field. Returns undefined when invalid/empty. */
function parseNumberField(name: string, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  if (name === "review_rating") return Math.min(5, Math.max(0, n));
  return n;
}

export default function VaultEditor() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // W91.5 — the operator's Vault is auto-populated from STAFFD_SELF.md;
  // manual edits to these fields are ignored server-side for that account.
  const [isOperator, setIsOperator] = useState(false);

  useEffect(() => {
    setIsOperator(isSuperAdminClient((pb.authStore.record as { email?: string } | null)?.email));
    void (async () => {
      try {
        const userId = pb.authStore.record?.id ?? "";
        if (!userId) return;
        const res = await pb.collection("businesses").getList(1, 1, {
          filter: `user = '${userId}'`,
        });
        const rec = res.items[0] as Record<string, unknown> | undefined;
        if (rec) {
          setRecordId(rec.id as string);
          const next: Record<string, string> = {};
          for (const name of ALL_FIELD_NAMES) {
            const v = rec[name];
            if (v !== undefined && v !== null && v !== "") next[name] = String(v);
          }
          setValues(next);
        }
      } catch { /* empty form — graceful for users with no profile yet */ }
      finally { setLoading(false); }
    })();
  }, []);

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      if (!userId) throw new Error("not signed in");

      const payload: Record<string, unknown> = {};
      for (const name of ALL_FIELD_NAMES) {
        const raw = values[name];
        if (raw === undefined) continue; // untouched fields stay untouched
        if (NUMBER_FIELDS.has(name)) {
          const parsed = parseNumberField(name, raw);
          if (raw.trim() && parsed === undefined) {
            throw new Error(`"${CATEGORIES.flatMap((c) => c.fields).find((f) => f.name === name)?.label}" needs a number`);
          }
          payload[name] = parsed ?? null;
        } else {
          payload[name] = raw;
        }
      }

      if (recordId) {
        await pb.collection("businesses").update(recordId, payload);
      } else {
        const rec = await pb.collection("businesses").create({ user: userId, ...payload });
        setRecordId((rec as { id: string }).id);
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Your business</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Your business</h2>
        {savedAt && <span className="text-xs" style={{ color: "#22C55E" }}>Saved ✓</span>}
      </div>
      <p className="text-xs mb-5" style={{ color: "#9090A8" }}>
        The more your staff knows, the sharper the work. Every field is optional.
      </p>

      {isOperator && (
        <div className="rounded-xl px-4 py-3 mb-5 text-xs" style={{ background: "rgba(91,33,232,0.08)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF" }}>
          Your Vault is auto-populated from STAFFD&apos;s canonical brand identity. Manual edits to these fields are ignored for the operator account.
        </div>
      )}

      <div className="flex flex-col gap-6">
        {CATEGORIES.map((cat) => (
          <div key={cat.title}>
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>
              {cat.title}
            </p>
            <div className="flex flex-col gap-3">
              {cat.fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`vault-${f.name}`}
                    className="text-xs font-semibold"
                    style={{ color: "#6060A0" }}
                  >
                    {f.label}
                  </label>
                  {f.multiline ? (
                    <textarea
                      id={`vault-${f.name}`}
                      value={values[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                      placeholder={f.placeholder}
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none resize-none"
                      style={inputStyle}
                    />
                  ) : (
                    <input
                      id={`vault-${f.name}`}
                      type="text"
                      value={values[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                      style={inputStyle}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="btn-primary px-4 py-2 rounded-lg text-xs font-semibold text-white"
          style={{ opacity: saving ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <span className="text-xs" style={{ color: "#EF4444" }}>{error}</span>}
      </div>
    </section>
  );
}

const cardStyle: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38" };
const inputStyle: React.CSSProperties = { background: "#0D0D16", border: "1px solid #2A2A38", color: "#F0F0F8" };
