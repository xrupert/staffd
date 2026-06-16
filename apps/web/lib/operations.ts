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
