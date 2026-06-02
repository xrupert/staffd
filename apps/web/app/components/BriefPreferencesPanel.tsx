"use client";

/**
 * Settings → Morning Brief preferences (Phase 26).
 *
 * Three controls + a snooze row:
 *
 *   • Timezone — autodetected via Intl, user-overridable
 *   • Preferred delivery hour — when the dispatcher fires the push (local)
 *   • Quiet hours — window during which pushes are deferred
 *   • Snooze actions — "Skip tomorrow", "Snooze 3 days", "Snooze 1 week",
 *                      "Snooze until <date>", and "Clear snooze"
 *
 * Status line at the top echoes the next-delivery summary so the user knows
 * exactly when their next brief lands.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type Prefs = {
  timezone: string | null;
  preferred_delivery_hour: number | null;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  brief_snoozed_until: string | null;
  skip_next_brief: boolean | null;
};

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#7070A0",
  marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  background: "#0D0D14",
  border: "1px solid #2A2A38",
  color: "#F0F0F8",
  borderRadius: "10px",
  padding: "8px 12px",
  fontSize: "13px",
  outline: "none",
  width: "100%",
};

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function formatHour(hour: number | null | undefined): string {
  if (hour === null || hour === undefined) return "—";
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:00 ${period}`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

export default function BriefPreferencesPanel() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/user/brief-preferences?userId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: token },
      });
      if (res.ok) {
        const data = await res.json();
        setPrefs(data.prefs as Prefs);
        setSummary(data.summary as string);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patch(p: Partial<Prefs>) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setWorking(true);
    setMsg(null);
    try {
      const res = await fetch("/api/user/brief-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, ...p }),
      });
      const data = await res.json();
      if (data.prefs) {
        setPrefs(data.prefs as Prefs);
        setSummary(data.summary as string);
        setMsg({ ok: true, text: "Saved." });
      } else {
        setMsg({ ok: false, text: data.error ?? "save_failed" });
      }
    } catch {
      setMsg({ ok: false, text: "network_error" });
    } finally {
      setWorking(false);
    }
  }

  function autodetectTimezone() {
    const tz = detectBrowserTimezone();
    void patch({ timezone: tz });
  }

  function snoozeDays(days: number) {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    void patch({ brief_snoozed_until: until, skip_next_brief: false });
  }

  function skipTomorrow() {
    void patch({ skip_next_brief: true, brief_snoozed_until: null });
  }

  function clearSnooze() {
    void patch({ brief_snoozed_until: null, skip_next_brief: false });
  }

  if (loading) {
    return (
      <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Morning Brief delivery</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  if (!prefs) return null;

  const hasTimezone = !!prefs.timezone?.trim();
  const hasDeliveryHour = typeof prefs.preferred_delivery_hour === "number";
  const isSnoozed = !!prefs.brief_snoozed_until && new Date(prefs.brief_snoozed_until).getTime() > Date.now();
  const willSkipTomorrow = !!prefs.skip_next_brief;

  return (
    <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
      <div className="mb-4">
        <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Morning Brief delivery</h2>
        <p className="text-xs mt-1" style={{ color: "#9090A8" }}>
          Set when your brief lands and which hours stay quiet. Without these, your brief pushes
          the moment your staff finishes (6 AM UTC).
        </p>
        <p
          className="text-xs mt-3 px-3 py-2 rounded-lg"
          style={{
            background: "rgba(91,33,232,0.08)",
            border: "1px solid rgba(91,33,232,0.25)",
            color: "#D0D0E8",
          }}
        >
          {summary || "Loading…"}
        </p>
      </div>

      {/* Timezone */}
      <div className="mb-5">
        <label style={labelStyle}>Timezone</label>
        <div className="flex items-center gap-2">
          <input
            value={prefs.timezone ?? ""}
            onChange={(e) => setPrefs((p) => (p ? { ...p, timezone: e.target.value } : p))}
            onBlur={(e) => { if (e.target.value !== prefs.timezone) void patch({ timezone: e.target.value }); }}
            placeholder="America/New_York"
            disabled={working}
            style={inputStyle}
          />
          <button
            onClick={autodetectTimezone}
            disabled={working}
            className="text-xs font-medium px-3 py-2 rounded-lg whitespace-nowrap"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8" }}
          >
            Autodetect
          </button>
        </div>
      </div>

      {/* Delivery hour */}
      <div className="mb-5">
        <label style={labelStyle}>Preferred delivery hour</label>
        <select
          value={hasDeliveryHour ? prefs.preferred_delivery_hour! : ""}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number.parseInt(e.target.value, 10);
            void patch({ preferred_delivery_hour: v });
          }}
          disabled={working}
          style={inputStyle}
        >
          <option value="">— immediately when generated —</option>
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>{formatHour(h)}</option>
          ))}
        </select>
        {!hasTimezone && hasDeliveryHour && (
          <p className="text-xs mt-2" style={{ color: "#F59E0B" }}>
            Set a timezone above so this delivery hour resolves to your local time.
          </p>
        )}
      </div>

      {/* Quiet hours */}
      <div className="mb-5">
        <label style={labelStyle}>Quiet hours (no notifications)</label>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={typeof prefs.quiet_hours_start === "number" ? prefs.quiet_hours_start : ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number.parseInt(e.target.value, 10);
              void patch({ quiet_hours_start: v });
            }}
            disabled={working}
            style={inputStyle}
          >
            <option value="">From… (off)</option>
            {HOUR_OPTIONS.map((h) => (
              <option key={`s${h}`} value={h}>From {formatHour(h)}</option>
            ))}
          </select>
          <select
            value={typeof prefs.quiet_hours_end === "number" ? prefs.quiet_hours_end : ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number.parseInt(e.target.value, 10);
              void patch({ quiet_hours_end: v });
            }}
            disabled={working}
            style={inputStyle}
          >
            <option value="">…until (off)</option>
            {HOUR_OPTIONS.map((h) => (
              <option key={`e${h}`} value={h}>Until {formatHour(h)}</option>
            ))}
          </select>
        </div>
        <p className="text-xs mt-2" style={{ color: "#5A5A70" }}>
          Crossing midnight is supported — e.g. From 10 PM, Until 7 AM.
        </p>
      </div>

      {/* Snooze actions */}
      <div className="pt-4" style={{ borderTop: "1px solid #1E1E2A" }}>
        <label style={labelStyle}>Snooze</label>
        {willSkipTomorrow && (
          <p
            className="text-xs mb-3 px-3 py-2 rounded-lg"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}
          >
            Tomorrow's brief will be skipped. Subsequent days run as usual.
          </p>
        )}
        {isSnoozed && (
          <p
            className="text-xs mb-3 px-3 py-2 rounded-lg"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}
          >
            Briefs paused until{" "}
            <strong>{new Date(prefs.brief_snoozed_until!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</strong>.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={skipTomorrow}
            disabled={working}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: working ? 0.5 : 1 }}
          >
            Skip tomorrow
          </button>
          <button
            onClick={() => snoozeDays(3)}
            disabled={working}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: working ? 0.5 : 1 }}
          >
            Snooze 3 days
          </button>
          <button
            onClick={() => snoozeDays(7)}
            disabled={working}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: working ? 0.5 : 1 }}
          >
            Snooze 1 week
          </button>
          {(willSkipTomorrow || isSnoozed) && (
            <button
              onClick={clearSnooze}
              disabled={working}
              className="px-3 py-1.5 rounded-lg text-xs font-medium ml-auto"
              style={{ background: "transparent", color: "#A07BFF", opacity: working ? 0.5 : 1 }}
            >
              Clear snooze
            </button>
          )}
        </div>
      </div>

      {msg && (
        <p className="text-xs mt-3" style={{ color: msg.ok ? "#22C55E" : "#EF4444" }}>{msg.text}</p>
      )}
    </section>
  );
}
