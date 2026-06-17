/**
 * Operations Home — pure helpers (W80.1).
 *
 * Card summaries + the "Have your specialist take this →" augmentation
 * prompt. The chip seeds the Command Center with this prompt (via ?ask=),
 * and the existing orchestrator routes it to the right specialist — so this
 * is the surface→specialist affordance from W80 Part 2, NOT a W63/W62 change.
 * Pure + exported so it's runtime-testable without rendering the page.
 */

export type OpsCard = "email" | "pipeline" | "inbox" | "analytics";

// ── Card summaries (one line each, from the FC-1 read shapes) ──────────────

export function summarizeEmail(
  data: { campaigns?: { name?: string; sent?: number }[] } | null,
): string {
  const list = data?.campaigns ?? [];
  if (list.length === 0) return "No campaigns yet.";
  const last = list[0];
  return `${list.length} campaign${list.length === 1 ? "" : "s"} · latest "${last?.name ?? "Untitled"}" (${last?.sent ?? 0} sent).`;
}

export function summarizePipeline(
  data: { results?: { name?: string }[] } | null,
): string {
  const n = data?.results?.length ?? 0;
  return n === 0 ? "No open opportunities." : `${n} open opportunit${n === 1 ? "y" : "ies"}.`;
}

export function summarizeInbox(
  data: { conversations?: unknown[] } | null,
): string {
  const n = data?.conversations?.length ?? 0;
  return n === 0 ? "Inbox clear — no open tickets." : `${n} open ticket${n === 1 ? "" : "s"}.`;
}

export function summarizeAnalytics(
  data: { visitors?: number; pageviews?: number } | null,
): string {
  if (!data) return "No analytics yet.";
  return `Today: ${data.visitors ?? 0} visitor${data.visitors === 1 ? "" : "s"}, ${data.pageviews ?? 0} pageview${data.pageviews === 1 ? "" : "s"}.`;
}

// ── Augmentation prompt (surface → specialist) ─────────────────────────────

const PROMPTS: Record<OpsCard, (summary: string) => string> = {
  email: (s) =>
    `Review my recent email campaign performance and recommend the next campaign to run — angle, subject line, and who to send it to.\n\nCurrent state: ${s}`,
  pipeline: (s) =>
    `Review my sales pipeline and tell me which opportunities to prioritize this week and the single best next action for each.\n\nCurrent state: ${s}`,
  inbox: (s) =>
    `Help me clear my support inbox: draft replies to the open tickets in my brand voice and flag anything urgent.\n\nCurrent state: ${s}`,
  analytics: (s) =>
    `Analyze my site traffic and tell me the top thing to focus on to grow it, with a concrete next step.\n\nCurrent state: ${s}`,
};

export function buildSpecialistPrompt(card: OpsCard, summary: string): string {
  return PROMPTS[card](summary || "(no data yet)");
}

// ── W91-rollback (Model B3) — no-data empty states ──────────────────────────
// Customers never "connect" a vendor account (backends are invisible
// operator-shared infrastructure). Empty states speak in STAFFD voice and
// point at the customer's staff or the upload path (CSV/archive cold-start,
// W95). Never vendor names, never "connect your account".
export type EmptyState = { text: string; cta: string; href: string };

export const frontDeskEmptyStates: Record<OpsCard, EmptyState> = {
  email: { text: "No campaigns yet — your specialist can draft one.", cta: "Ask your specialist →", href: "/dashboard?ask=Draft%20my%20first%20email%20campaign" },
  pipeline: { text: "No contacts yet — upload a CSV or ask your specialist to add some.", cta: "Add contacts →", href: "/dashboard/upload" },
  inbox: { text: "Inbox clear — your specialist will draft replies as messages come in.", cta: "Ask your specialist →", href: "/dashboard?ask=Help%20me%20handle%20incoming%20support%20messages" },
  analytics: { text: "Tracking not set up yet — your specialist can help.", cta: "Ask your specialist →", href: "/dashboard?ask=Help%20me%20set%20up%20site%20analytics" },
};

// ── W80.2 Email Campaigns ──────────────────────────────────────────────────

/** User-facing campaign status — no vendor terms (BRAND_VOICE). */
export function campaignStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "scheduled": return "Scheduled";
    case "running": return "Sending";
    case "finished": return "Sent";
    case "paused": return "Paused";
    case "cancelled": return "Cancelled";
    default: return "Draft";
  }
}

/** Compose "Make this smart →" — hands the draft to the email specialist. */
export function buildCampaignSmartPrompt(subject: string, body: string): string {
  const draft = `Subject: ${subject?.trim() || "(no subject yet)"}\n\n${(body?.trim() || "(empty)").slice(0, 1500)}`;
  return `Sharpen this email campaign for me — give me a stronger subject line, tighter body copy, and the best time to send it.\n\n---\n${draft}\n---`;
}

// ── W80.3 Site Analytics ────────────────────────────────────────────────────

export type AnalyticsRange = "day" | "7d" | "30d";

export type AnalyticsView = {
  range: AnalyticsRange;
  headline: { visitors: number; pageviews: number; bounceRate: number; visitDuration: number };
  sources: { name: string; visitors: number }[];
  pages: { name: string; pageviews: number }[];
  countries: { name: string; visitors: number }[];
  timeseries: { date: string; visitors: number }[];
};

/** Operator-friendly range label — three fixed windows, no date jargon. */
export function analyticsRangeLabel(range: AnalyticsRange): string {
  switch (range) {
    case "day": return "Today";
    case "30d": return "Last 30 days";
    case "7d":
    default: return "Last 7 days";
  }
}

/** Average visit duration (seconds) → "2m 5s" / "45s". */
export function formatVisitDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "Make sense of this →" — hands the current view to the analytics specialist. */
export function buildAnalyticsSmartPrompt(view: AnalyticsView): string {
  const { headline: h } = view;
  const top = (rows: { name: string }[]) => rows.slice(0, 3).map((r) => r.name).join(", ") || "—";
  return [
    `Make sense of my site traffic for ${analyticsRangeLabel(view.range)} and tell me what to do next.`,
    "",
    `Visitors: ${h.visitors} · Pageviews: ${h.pageviews} · Bounce rate: ${h.bounceRate}% · Avg visit: ${formatVisitDuration(h.visitDuration)}`,
    `Top sources: ${top(view.sources)}`,
    `Top pages: ${top(view.pages)}`,
    `Top countries: ${top(view.countries)}`,
    "",
    "Interpret these numbers, call out any anomalies or notable shifts, and give me the single best next move to grow traffic.",
  ].join("\n");
}
