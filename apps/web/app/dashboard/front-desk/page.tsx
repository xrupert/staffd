"use client";

/**
 * /dashboard/front-desk — Operations Home / "Front Desk" (W80.1).
 *
 * NOTE: routed to /front-desk, not /operations — /dashboard/operations is the
 * Operations *department* room (Standard #9). Old /cockpit URL 301-redirects.
 *
 * One surface aggregating the operator's connected tools into STAFFD's shell:
 * email campaigns, sales pipeline, support inbox, site analytics — each a
 * read-only summary card with a "Have your specialist take this →" chip that
 * seeds the Command Center (surface→specialist, W80 Part 2 — not W63/W62).
 *
 * Operator-scoped (decision b): data renders only for the super-admin; the
 * page is reachable by all but non-operators see the "connect your tools"
 * state. Per-user credentials (W91) open live data to every customer. Vendor
 * names never appear (BRAND_VOICE).
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../lib/pb";
import {
  buildSpecialistPrompt,
  summarizeEmail,
  summarizePipeline,
  summarizeInbox,
  summarizeAnalytics,
  type OpsCard,
} from "../../../lib/operations";

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

type CardState = { summary: string; connected: boolean; loading: boolean };
const INITIAL: CardState = { summary: "", connected: true, loading: true };

export default function FrontDeskHome() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [email, setEmail] = useState<CardState>(INITIAL);
  const [pipeline, setPipeline] = useState<CardState>(INITIAL);
  const [inbox, setInbox] = useState<CardState>(INITIAL);
  const [analytics, setAnalytics] = useState<CardState>(INITIAL);
  const [meetings, setMeetings] = useState<{ label: string; when: string }[] | null>(null);

  const loadCard = useCallback(
    async (path: string, set: (s: CardState) => void, summarize: (d: unknown) => string) => {
      try {
        const sep = path.includes("?") ? "&" : "?";
        const res = await fetch(`${path}${sep}pbToken=${encodeURIComponent(pb.authStore.token)}`);
        if (res.status === 503) { set({ summary: "Not connected yet.", connected: false, loading: false }); return; }
        if (!res.ok) { set({ summary: "Couldn't load.", connected: true, loading: false }); return; }
        set({ summary: summarize(await res.json()), connected: true, loading: false });
      } catch {
        set({ summary: "Couldn't load.", connected: true, loading: false });
      }
    },
    [],
  );

  useEffect(() => {
    // W91 — open to every authenticated user. Each card resolves the user's
    // own creds (operator falls back to env); missing creds → per-card
    // "Connect your tools" state. No super-admin gate here anymore.
    const authed = pb.authStore.isValid;
    setIsAdmin(authed);
    if (!authed) return;

    void loadCard("/api/integrations/listmonk", setEmail, (d) => summarizeEmail(d as never));
    void loadCard("/api/integrations/twenty?type=opportunities", setPipeline, (d) => summarizePipeline(d as never));
    void loadCard("/api/integrations/chatwoot?status=open", setInbox, (d) => summarizeInbox(d as never));
    void loadCard("/api/integrations/plausible", setAnalytics, (d) => summarizeAnalytics(d as never));

    // Calendar contextual strip — today's bookings (existing substrate).
    void (async () => {
      try {
        const uid = pb.authStore.record?.id ?? "";
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(); end.setHours(23, 59, 59, 999);
        const rows = await pb.collection("bookings").getList(1, 5, {
          filter: `user='${uid}' && start_time>='${start.toISOString()}' && start_time<='${end.toISOString()}'`,
          sort: "start_time",
        });
        setMeetings(rows.items.map((b) => ({
          label: (b.name as string) || (b.attendee_name as string) || "Meeting",
          when: new Date(b.start_time as string).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        })));
      } catch { setMeetings([]); }
    })();
  }, [loadCard]);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`, backgroundSize: "64px 64px" }} />
      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Dashboard</a>
        </header>

        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Front Desk</p>
          <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "1.75rem", letterSpacing: "-0.02em" }}>Your business, in one place.</h1>
          <p className="text-sm" style={{ color: "#7070A0", lineHeight: 1.6 }}>Campaigns, pipeline, support, and traffic — with your staff one click away on each.</p>
        </div>

        {isAdmin === false ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: "40px" }}>
            <p className="text-sm" style={{ color: "#9090A8" }}>Sign in to see your campaigns, pipeline, support, and analytics in one view.</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl px-4 py-3 mb-6 flex items-center gap-3" style={{ background: "rgba(91,33,232,0.06)", border: "1px solid rgba(91,33,232,0.2)" }}>
              <span style={{ fontSize: "15px" }}>🗓️</span>
              <p className="text-xs" style={{ color: "#D0D0E8" }}>
                {meetings === null ? "Loading today…"
                  : meetings.length === 0 ? "Nothing scheduled today."
                  : `Today: ${meetings.map((m) => `${m.label} (${m.when})`).join(" · ")}`}
              </p>
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              <OpsCardView title="Email Campaigns" icon="📧" card="email" state={email} drill={{ href: "/dashboard/front-desk/campaigns", label: "Open campaigns →" }} />
              <OpsCardView title="Sales Pipeline" icon="📇" card="pipeline" state={pipeline} />
              <OpsCardView title="Support Inbox" icon="🎫" card="inbox" state={inbox} />
              <OpsCardView title="Site Analytics" icon="📈" card="analytics" state={analytics} drill={{ href: "/dashboard/front-desk/analytics", label: "Open analytics →" }} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function OpsCardView({ title, icon, card, state, drill }: { title: string; icon: string; card: OpsCard; state: CardState; drill?: { href: string; label: string } }) {
  // A card with a native surface (e.g. Email Campaigns) drills in; the rest
  // seed the Command Center with a specialist prompt (surface→specialist).
  // W91 — not connected (and not loading) → deep-link to Settings to connect.
  const notConnected = !state.connected && !state.loading;
  const href = notConnected
    ? "/dashboard/settings#connect-your-tools"
    : drill ? drill.href : `/dashboard?ask=${encodeURIComponent(buildSpecialistPrompt(card, state.summary))}`;
  const label = notConnected ? "Connect your tools →" : drill ? drill.label : "Have your specialist take this →";
  return (
    <div style={cardStyle}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <p className="font-semibold text-sm" style={{ color: "#F0F0F8" }}>{title}</p>
      </div>
      <p className="text-xs mb-4" style={{ color: state.connected ? "#9090A8" : "#5A5A70", lineHeight: 1.5, minHeight: "32px" }}>
        {state.loading ? "Loading…" : state.summary}
      </p>
      {!state.loading && (
        <a href={href} className="text-xs px-3 py-1.5 rounded-lg inline-block transition-colors hover:text-white" style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.30)", color: "#A07BFF", textDecoration: "none" }}>
          {label}
        </a>
      )}
    </div>
  );
}
