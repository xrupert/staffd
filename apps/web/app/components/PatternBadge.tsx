"use client";

/**
 * PatternBadge — small chip showing one "successful pattern" the engine
 * has noticed about this user's work. Read source: GET /api/vault/patterns/list.
 *
 * Per W14 ("CreditsWidget feels heavy-handed"), kept visually quiet —
 * a small chip with a weight bar + hover tooltip. Not a banner. Not a modal.
 *
 * Usage:
 *   <PatternBadgeList />                  // self-fetches user's top-3 patterns
 *   <PatternBadge pattern={…} />          // controlled single-chip render
 *
 * Empty pattern list → renders nothing (silent fail-safe).
 */

import React, { useEffect, useState } from "react";
import pb from "../../lib/pb";

// React is imported above for compatibility with vitest's classic JSX runtime
// (Next.js prod build uses automatic runtime; tests run via a different
// transformer that still expects React in scope).
void React;

export type Pattern = {
  signal: string;
  weight: number;
  count: number;
  label: string;
};

const SIGNAL_DISPLAY: Record<string, { emoji: string; short: string }> = {
  kept:            { emoji: "📌", short: "kept" },
  shared:          { emoji: "↗️", short: "shared" },
  published:       { emoji: "🚀", short: "published" },
  regenerated:     { emoji: "🔁", short: "iterated" },
  engagement_high: { emoji: "📈", short: "engagement" },
  conversion:      { emoji: "🎯", short: "converted" },
  bounce:          { emoji: "📉", short: "bounced" },
};

const MAX_WEIGHT = 2.5; // matches PATTERN_WEIGHTS in vault/patterns.ts

export function PatternBadge({ pattern }: { pattern: Pattern }): React.JSX.Element | null {
  if (!pattern || !pattern.signal) return null;
  const display = SIGNAL_DISPLAY[pattern.signal] ?? { emoji: "✦", short: pattern.signal };
  const widthPct = Math.min(100, Math.round((pattern.weight / MAX_WEIGHT) * 100));

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
      style={{
        background: "rgba(160,123,255,0.08)",
        border: "1px solid rgba(160,123,255,0.25)",
        color: "#A07BFF",
      }}
      title={`${pattern.label} (×${pattern.count.toLocaleString()})`}
    >
      <span>{display.emoji}</span>
      <span style={{ color: "#D0D0E8" }}>{display.short}</span>
      <span
        className="inline-block rounded-full"
        style={{
          width: "24px",
          height: "3px",
          background: "rgba(160,123,255,0.20)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          className="inline-block rounded-full"
          style={{
            position: "absolute",
            inset: 0,
            width: `${widthPct}%`,
            background: "#A07BFF",
          }}
        />
      </span>
    </span>
  );
}

export default function PatternBadgeList({ limit = 3 }: { limit?: number }): React.JSX.Element | null {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!pb.authStore.isValid) {
          setLoaded(true);
          return;
        }
        const token = pb.authStore.token;
        const res = await fetch(
          `/api/vault/patterns/list?pbToken=${encodeURIComponent(token)}&limit=${limit}`,
        );
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = (await res.json()) as { patterns?: Pattern[] };
        if (!cancelled) {
          setPatterns(data.patterns ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  // Silent fail-safe: no patterns yet → render nothing
  if (!loaded || patterns.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs" style={{ color: "#5A5A70" }}>
        STAFFD is leaning on:
      </span>
      {patterns.map((p) => (
        <PatternBadge key={p.signal} pattern={p} />
      ))}
    </div>
  );
}
