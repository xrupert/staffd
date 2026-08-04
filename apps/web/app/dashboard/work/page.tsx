"use client";

/**
 * Staff Work Board — every piece of staff work on one kanban:
 * Planned → In progress → Waiting on you → Done. Feeds from
 * /api/work/board (scheduled_content + workflows + generation_jobs).
 */

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import pb from "../../../lib/pb";

type Card = {
  id: string;
  source: "scheduled" | "workflow" | "generation";
  title: string;
  subtitle: string;
  date: string;
  failed?: boolean;
  href?: string;
};

type Board = Record<"planned" | "in_progress" | "review" | "done", Card[]>;

const COLUMNS: Array<{ key: keyof Board; label: string; hint: string; accent: string }> = [
  { key: "planned",     label: "Planned",        hint: "On the calendar",        accent: "#7C4FF0" },
  { key: "in_progress", label: "In progress",    hint: "Being worked right now", accent: "#38BDF8" },
  { key: "review",      label: "Waiting on you", hint: "Needs your approval",    accent: "#F59E0B" },
  { key: "done",        label: "Done",           hint: "Last 14 days",           accent: "#22C55E" },
];

const SOURCE_BADGE: Record<Card["source"], { label: string; icon: string }> = {
  scheduled:  { label: "Calendar", icon: "🗓️" },
  workflow:   { label: "Workflow", icon: "🧭" },
  generation: { label: "Studio",   icon: "🎬" },
};

export default function WorkBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/work/board", { headers: { Authorization: pb.authStore.token } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { board?: Board };
      if (data.board) { setBoard(data.board); setError(null); }
    } catch {
      setError("Couldn't load the board — check your connection and refresh.");
    }
  }, []);

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    void load();
    const iv = setInterval(() => void load(), 30_000);
    return () => clearInterval(iv);
  }, [load]);

  const total = board ? Object.values(board).reduce((n, c) => n + c.length, 0) : 0;

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
        backgroundSize: "64px 64px",
      }} />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-10">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#7A7A95" }}>
            ← Dashboard
          </a>
        </header>

        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Staff Work Board</p>
          <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            What your staff is working on
          </h1>
          <p className="text-sm mt-2" style={{ color: "#7A7A95" }}>
            Every planned, running, and finished piece of work — in one view.
          </p>
        </div>

        {error && <p className="text-sm mb-6" style={{ color: "#EF4444" }}>{error}</p>}

        {!board && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {COLUMNS.map((c) => (
              <div key={c.key} className="rounded-2xl p-4 skeleton" style={{ background: "#111118", border: "1px solid #2A2A38", minHeight: 220 }} />
            ))}
          </div>
        )}

        {board && total === 0 && (
          <div className="rounded-2xl px-8 py-16 text-center" style={{ background: "#111118", border: "1px dashed #2A2A38" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "#D0D0E8" }}>Nothing on the board yet</p>
            <p className="text-xs" style={{ color: "#7A7A95" }}>
              Brief a specialist or schedule a campaign — the work lands here as it happens.
            </p>
          </div>
        )}

        {board && total > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {COLUMNS.map((col) => (
              <div key={col.key} className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #1E1E2A" }}>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>{col.label}</p>
                    <p className="text-[10px]" style={{ color: "#5A5A75" }}>{col.hint}</p>
                  </div>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `${col.accent}22`, color: col.accent, border: `1px solid ${col.accent}44` }}
                  >
                    {board[col.key].length}
                  </span>
                </div>
                <div className="p-2.5 flex flex-col gap-2" style={{ minHeight: 120 }}>
                  {board[col.key].length === 0 && (
                    <p className="text-[11px] px-1.5 py-4 text-center" style={{ color: "#3A3A55" }}>Empty</p>
                  )}
                  {board[col.key].map((card) => {
                    const badge = SOURCE_BADGE[card.source];
                    const body = (
                      <div
                        className="rounded-xl px-3 py-2.5 transition-colors"
                        style={{
                          background: "#16161F",
                          border: `1px solid ${card.failed ? "rgba(239,68,68,0.35)" : "#232330"}`,
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px]">{badge.icon}</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#7070A0" }}>{badge.label}</span>
                          {card.failed && (
                            <span className="text-[10px] font-semibold ml-auto" style={{ color: "#EF4444" }}>failed</span>
                          )}
                        </div>
                        <p className="text-xs" style={{ color: "#D0D0E8", lineHeight: 1.45 }}>{card.title}</p>
                        {card.subtitle && (
                          <p className="text-[10px] mt-1" style={{ color: "#5A5A75" }}>{card.subtitle}</p>
                        )}
                      </div>
                    );
                    return card.href ? (
                      <a key={card.id} href={card.href} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>{body}</a>
                    ) : (
                      <div key={card.id}>{body}</div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
