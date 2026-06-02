"use client";

/**
 * Settings → Autopilot controls (Phase 9).
 *
 * Three states the user can be in:
 *   • Active  — Morning Brief runs nightly, voice profile recomputes, etc.
 *   • Paused  — temporary snooze (1 day / 1 week / 1 month / custom)
 *   • Off     — autonomy disabled until user re-enables
 *
 * Vault ingestion + retrieval + voice fingerprint stay ON regardless — those
 * are MEMORY, not autonomy. Only worker-driven autonomous generation respects
 * this control.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type AutopilotStatus = "active" | "paused" | "off";

type AutopilotState = {
  mode: "on" | "off";
  pauseUntil: string | null;
  status: AutopilotStatus;
};

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
};

function pillStyle(status: AutopilotStatus): React.CSSProperties {
  const map: Record<AutopilotStatus, { bg: string; fg: string; border: string }> = {
    active: { bg: "rgba(34,197,94,0.10)", fg: "#22C55E", border: "rgba(34,197,94,0.25)" },
    paused: { bg: "rgba(245,158,11,0.10)", fg: "#F59E0B", border: "rgba(245,158,11,0.25)" },
    off:    { bg: "rgba(239,68,68,0.10)", fg: "#EF4444", border: "rgba(239,68,68,0.25)" },
  };
  const c = map[status];
  return {
    display: "inline-block",
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "3px 8px",
    borderRadius: "999px",
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
  };
}

function statusLabel(status: AutopilotStatus): string {
  return status === "active" ? "ACTIVE" : status === "paused" ? "PAUSED" : "OFF";
}

function humanizeUntil(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  if (t <= Date.now()) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function AutopilotControlsPanel() {
  const [state, setState] = useState<AutopilotState | null>(null);
  const [briefSummary, setBriefSummary] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) { setLoading(false); return; }
    try {
      // Phase 26 — fetch autopilot state + brief-delivery summary in parallel
      // so the panel shows "Next brief at 7:00 AM your time" inline.
      const [autoRes, briefRes] = await Promise.all([
        fetch(`/api/user/autopilot?userId=${encodeURIComponent(userId)}`, {
          headers: { Authorization: token },
        }),
        fetch(`/api/user/brief-preferences?userId=${encodeURIComponent(userId)}`, {
          headers: { Authorization: token },
        }).catch(() => null),
      ]);
      if (autoRes.ok) {
        const data = await autoRes.json();
        setState({
          mode: data.mode,
          pauseUntil: data.pauseUntil,
          status: data.status,
        });
      }
      if (briefRes && briefRes.ok) {
        const briefData = await briefRes.json();
        setBriefSummary(briefData.summary ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function update(patch: { mode?: "on" | "off"; pauseUntil?: string | null }) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setWorking(true);
    setMsg(null);
    try {
      const res = await fetch("/api/user/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, ...patch }),
      });
      const data = await res.json();
      if (data.ok) {
        setState({ mode: data.mode, pauseUntil: data.pauseUntil, status: data.status });
        setMsg({ ok: true, text: msgForState(data.status, data.pauseUntil) });
      } else {
        setMsg({ ok: false, text: data.error ?? "update_failed" });
      }
    } catch {
      setMsg({ ok: false, text: "network_error" });
    } finally {
      setWorking(false);
    }
  }

  function msgForState(status: AutopilotStatus, until: string | null): string {
    if (status === "off") return "Autopilot disabled. STAFFD will only act when you ask.";
    if (status === "paused") return `Paused until ${humanizeUntil(until)}.`;
    return "Autopilot active. Your staff is on duty.";
  }

  function pauseForDays(days: number) {
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    void update({ mode: "on", pauseUntil: until });
  }

  function resume() { void update({ mode: "on", pauseUntil: null }); }
  function disable() { void update({ mode: "off", pauseUntil: null }); }

  if (loading) {
    return (
      <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Autopilot</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  if (!state) return null;

  const isActive = state.status === "active";
  const isPaused = state.status === "paused";
  const isOff = state.status === "off";

  return (
    <section className="rounded-2xl p-6 mb-5" style={cardStyle}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Autopilot</h2>
          <p className="text-xs mt-1" style={{ color: "#9090A8" }}>
            Controls whether STAFFD generates work on its own — Morning Briefs, scheduled content, proactive nudges. Memory (Vault, voice profile) is always on.
          </p>
        </div>
        <span style={pillStyle(state.status)}>{statusLabel(state.status)}</span>
      </div>

      {isActive && briefSummary && (
        <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>
          {briefSummary}
        </p>
      )}
      {isPaused && (
        <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
          Paused until <strong>{humanizeUntil(state.pauseUntil)}</strong>. Your staff will resume autonomously after that.
        </p>
      )}
      {isOff && (
        <p className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ color: "#EF4444", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
          Autopilot is off. STAFFD will only act when you ask directly. You can re-enable below.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {isActive && (
          <>
            <button onClick={() => pauseForDays(1)} disabled={working} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={btnSecondary(working)}>
              Pause 1 day
            </button>
            <button onClick={() => pauseForDays(7)} disabled={working} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={btnSecondary(working)}>
              Pause 1 week
            </button>
            <button onClick={() => pauseForDays(30)} disabled={working} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={btnSecondary(working)}>
              Pause 1 month
            </button>
            <button onClick={() => disable()} disabled={working} className="ml-auto text-xs transition-colors hover:text-white" style={{ color: "#EF4444", opacity: working ? 0.5 : 1 }}>
              Disable autopilot
            </button>
          </>
        )}
        {(isPaused || isOff) && (
          <button onClick={() => resume()} disabled={working} className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ opacity: working ? 0.5 : 1 }}>
            {working ? "Resuming…" : "Resume autopilot"}
          </button>
        )}
      </div>

      {msg && (
        <p className="text-xs mt-3" style={{ color: msg.ok ? "#22C55E" : "#EF4444" }}>{msg.text}</p>
      )}
    </section>
  );
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    background: "#1A1A24",
    border: "1px solid #2A2A38",
    color: disabled ? "#5A5A70" : "#D0D0E8",
    opacity: disabled ? 0.6 : 1,
  };
}
