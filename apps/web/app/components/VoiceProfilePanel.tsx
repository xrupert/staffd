"use client";

/**
 * Settings → Voice Profile panel (Phase 2 / Task #1).
 *
 * Displays the user's brand-voice fingerprint metrics and the pre-rendered
 * `voicePromptText` that every applicable agent reads. "Recompute now"
 * button triggers an on-demand POST so the user can see the effect of a
 * recent batch of kept/shared work without waiting for the nightly cron.
 *
 * Empty / low-confidence state coaches the user to produce more work
 * (especially Share / Publish signals) so the profile sharpens.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

type PunctuationStyle = {
  emDashPer1000?: number;
  exclamationPer1000?: number;
  semicolonPer1000?: number;
  ellipsisPer1000?: number;
  oxfordCommaUsage?: number;
};

type VoiceProfile = {
  id?: string;
  user?: string;
  avgSentenceLength?: number;
  formalityScore?: number;
  emojiFrequency?: number;
  commonOpeners?: string[];
  commonClosers?: string[];
  bannedWords?: string[];
  positivityScore?: number;
  punctuationStyle?: PunctuationStyle;
  documentCount?: number;
  confidence?: "low" | "medium" | "high";
  voicePromptText?: string;
  updated?: string;
};

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "24px",
  marginBottom: "20px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 500,
  color: "#7070A0",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "4px",
};

const valueStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#F0F0F8",
};

const pillStyle = (variant: "low" | "medium" | "high"): React.CSSProperties => {
  const colors = {
    low:    { bg: "rgba(239,68,68,0.10)", fg: "#EF4444", border: "rgba(239,68,68,0.25)" },
    medium: { bg: "rgba(245,158,11,0.10)", fg: "#F59E0B", border: "rgba(245,158,11,0.25)" },
    high:   { bg: "rgba(34,197,94,0.10)", fg: "#22C55E", border: "rgba(34,197,94,0.25)" },
  }[variant];
  return {
    display: "inline-block",
    padding: "3px 10px",
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderRadius: "999px",
    background: colors.bg,
    color: colors.fg,
    border: `1px solid ${colors.border}`,
  };
};

function formatNumber(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null) return "—";
  if (Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function formalityLabel(score: number | undefined): string {
  if (score === undefined) return "—";
  if (score < 0.4) return "Informal";
  if (score < 0.65) return "Professional";
  return "Formal";
}

function positivityLabel(score: number | undefined): string {
  if (score === undefined) return "—";
  if (score < 0.4) return "Balanced";
  if (score <= 0.6) return "Neutral";
  return "Warm";
}

function emojiLabel(freq: number | undefined): string {
  if (freq === undefined) return "—";
  if (freq === 0) return "Never";
  if (freq < 2) return "Rare";
  if (freq < 10) return "Occasional";
  return "Frequent";
}

export default function VoiceProfilePanel() {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  async function load() {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/vault/voice-profile?userId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: token },
      });
      const data = await res.json();
      if (data.ok) setProfile(data.profile ?? null);
      else setError(data.reason ?? "load_failed");
    } catch {
      setError("load_failed");
    } finally {
      setLoading(false);
    }
  }

  async function recompute() {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch("/api/vault/voice-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token }),
      });
      const data = await res.json();
      if (data.ok) setProfile(data.profile ?? null);
      else setError(data.reason ?? "recompute_failed");
    } catch {
      setError("recompute_failed");
    } finally {
      setRecomputing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <section style={cardStyle}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Voice Profile</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
      </section>
    );
  }

  // Empty state — no training data yet
  if (!profile) {
    return (
      <section style={cardStyle}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "#F0F0F8" }}>Voice Profile</h2>
        <p className="text-xs leading-relaxed mb-4" style={{ color: "#9090A8" }}>
          STAFFD learns your voice from the work you keep, share, and publish. Once you have a few drafts in your library, your staff will start writing in your tone automatically.
        </p>
        <button
          onClick={() => void recompute()}
          disabled={recomputing}
          className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ opacity: recomputing ? 0.5 : 1 }}
        >
          {recomputing ? "Scanning…" : "Scan now"}
        </button>
        {error && (
          <p className="text-xs mt-3" style={{ color: "#EF4444" }}>
            {error === "insufficient_training_data"
              ? "Not enough work in your library yet. Generate a few drafts first."
              : `Couldn't scan: ${error}`}
          </p>
        )}
      </section>
    );
  }

  const conf = profile.confidence ?? "low";
  const updated = profile.updated ? new Date(profile.updated).toLocaleString() : "—";

  return (
    <section style={cardStyle}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold mb-1" style={{ color: "#F0F0F8" }}>Voice Profile</h2>
          <p className="text-xs" style={{ color: "#5A5A70" }}>
            Trained on {profile.documentCount ?? 0} document{profile.documentCount === 1 ? "" : "s"} · Updated {updated}
          </p>
        </div>
        <span style={pillStyle(conf)}>{conf} confidence</span>
      </div>

      {conf === "low" && (
        <p className="text-xs leading-relaxed mb-4 px-3 py-2 rounded-lg" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
          Your fingerprint is still warming up. Share or publish a few more pieces of work and we'll lock it in.
        </p>
      )}

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <div style={labelStyle}>Sentence length</div>
          <div style={valueStyle}>{formatNumber(profile.avgSentenceLength, 0)} words avg</div>
        </div>
        <div>
          <div style={labelStyle}>Tone</div>
          <div style={valueStyle}>{formalityLabel(profile.formalityScore)}</div>
        </div>
        <div>
          <div style={labelStyle}>Mood</div>
          <div style={valueStyle}>{positivityLabel(profile.positivityScore)}</div>
        </div>
        <div>
          <div style={labelStyle}>Emoji</div>
          <div style={valueStyle}>{emojiLabel(profile.emojiFrequency)}</div>
        </div>
      </div>

      {/* Openers */}
      {profile.commonOpeners && profile.commonOpeners.length > 0 && (
        <div className="mb-4">
          <div style={labelStyle}>Common openers</div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {profile.commonOpeners.slice(0, 5).map((o, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-md" style={{ background: "#1A1A24", color: "#D0D0E8", border: "1px solid #2A2A38" }}>
                "{o}"
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Closers */}
      {profile.commonClosers && profile.commonClosers.length > 0 && (
        <div className="mb-4">
          <div style={labelStyle}>Common closers</div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {profile.commonClosers.slice(0, 5).map((o, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-md" style={{ background: "#1A1A24", color: "#D0D0E8", border: "1px solid #2A2A38" }}>
                "{o}"
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Banned jargon */}
      {profile.bannedWords && profile.bannedWords.length > 0 && (
        <div className="mb-4">
          <div style={labelStyle}>Jargon your staff will avoid</div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {profile.bannedWords.slice(0, 10).map((w, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-md" style={{ background: "rgba(91,33,232,0.10)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.25)" }}>
                {w}
              </span>
            ))}
            {profile.bannedWords.length > 10 && (
              <span className="text-xs px-2 py-1" style={{ color: "#5A5A70" }}>
                +{profile.bannedWords.length - 10} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Full prompt preview (collapsed by default) */}
      {profile.voicePromptText && (
        <div className="mb-4">
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="text-xs font-medium transition-colors"
            style={{ color: "#A07BFF" }}
          >
            {showPrompt ? "Hide" : "Show"} what your staff reads →
          </button>
          {showPrompt && (
            <pre className="mt-2 px-3 py-3 rounded-lg text-xs whitespace-pre-wrap" style={{
              background: "#0D0D16",
              border: "1px solid #2A2A38",
              color: "#D0D0E8",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              lineHeight: 1.5,
            }}>
              {profile.voicePromptText}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid #1E1E2A" }}>
        <p className="text-xs" style={{ color: "#5A5A70" }}>
          Auto-updates nightly + after every share or publish.
        </p>
        <button
          onClick={() => void recompute()}
          disabled={recomputing}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: "#1A1A24",
            border: "1px solid #2A2A38",
            color: recomputing ? "#5A5A70" : "#D0D0E8",
            opacity: recomputing ? 0.6 : 1,
          }}
        >
          {recomputing ? "Recomputing…" : "Recompute now"}
        </button>
      </div>

      {error && (
        <p className="text-xs mt-3" style={{ color: "#EF4444" }}>Couldn't update: {error}</p>
      )}
    </section>
  );
}
