/**
 * Outcome feedback layer (Phase 5).
 *
 * Two surfaces:
 *
 *   recordOutcome({document_id?, source_kind, metric, value, ...})
 *     → infers a `PatternSignal` from the metric+value
 *     → when a document is linked, delegates to `recordPattern` so the
 *       doc's retrieval weight rises (or falls — bounce signal downweights)
 *     → ALWAYS writes a `vault_decisions` row tagged
 *       `decision_kind="outcome_observed"` so the CEO briefing surfaces it
 *       even when the doc link is unknown
 *
 *   recordDecision({decision_kind, title, ...})
 *     → writes a `vault_decisions` row directly (no pattern bump)
 *     → used for "thing happened" events: contract signed, deal closed,
 *       meeting booked, manual strategic call
 *
 * Webhook receivers (`/api/webhooks/listmonk`, `/docuseal`, `/twenty`)
 * translate their upstream payloads into these two shapes and call this lib
 * directly — no self-HTTP through `/api/vault/outcome` (that endpoint is
 * reserved for manual / future external callers).
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import { recordPattern, type PatternSignal } from "./patterns";

// ──────────────────────────────────────────────────────────────────────────
// Signal inference — maps (metric, value) to a PatternSignal
// ──────────────────────────────────────────────────────────────────────────

const ENGAGEMENT_THRESHOLDS: Record<string, number> = {
  email_open_rate:    0.25,  // 25% open rate
  email_click_rate:   0.05,  // 5% click rate
  page_views_7d:      100,   // 100 views in last 7 days
  social_engagement:  50,    // 50 likes/comments/shares
};

const CONVERSION_METRICS = new Set<string>([
  "conversion",
  "checkout_completed",
  "form_submitted",
  "deal_closed",
  "signature_completed",
]);

const BOUNCE_METRICS = new Set<string>([
  "email_unsubscribe",
  "email_complaint",
  "email_hard_bounce",
]);

export function inferSignal(metric: string, value: number): PatternSignal | null {
  if (CONVERSION_METRICS.has(metric)) return "conversion";
  if (BOUNCE_METRICS.has(metric)) return "bounce";
  const threshold = ENGAGEMENT_THRESHOLDS[metric];
  if (threshold !== undefined && value >= threshold) return "engagement_high";
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type OutcomeSourceKind =
  | "listmonk"
  | "plausible"
  | "docuseal"
  | "twenty"
  | "chatwoot"
  | "manual";

export type RecordOutcomeInput = {
  userId: string;
  client?: string | null;
  document_id?: string;
  source_kind: OutcomeSourceKind;
  source_id?: string;
  metric: string;
  value: number;
  /** Override the inferred signal. Use for explicit caller-supplied signals. */
  signal?: PatternSignal;
  observed_at?: string;
  /** Extra context surfaced in CEO brief (dept, topic, tags). */
  scope?: Record<string, unknown>;
  /** Title for the vault_decisions row; auto-generated when omitted. */
  title?: string;
};

export type RecordOutcomeResult = {
  ok: boolean;
  patternRecorded: boolean;
  signal?: PatternSignal;
  decisionId?: string;
  reason?: string;
};

export type DecisionKind =
  | "contract_signed"
  | "deal_closed"
  | "meeting_booked"
  | "content_published"
  | "outcome_observed"
  | "strategic"
  | "manual"
  | string; // permissive — callers may use ad-hoc kinds

export type RecordDecisionInput = {
  userId: string;
  client?: string | null;
  decision_kind: DecisionKind;
  title: string;
  source_kind?: OutcomeSourceKind;
  source_id?: string;
  document_id?: string;
  scope?: Record<string, unknown>;
  impact?: Record<string, unknown>;
  expires_at?: string;
};

export type RecordDecisionResult = {
  ok: boolean;
  id?: string;
  reason?: string;
};

// ──────────────────────────────────────────────────────────────────────────
// recordOutcome
// ──────────────────────────────────────────────────────────────────────────

export async function recordOutcome(input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
  if (!input.userId || !input.metric) {
    return { ok: false, patternRecorded: false, reason: "missing_required_fields" };
  }

  const signal = input.signal ?? inferSignal(input.metric, input.value);

  // 1. If we have a document AND an inferred signal, bump the doc's pattern
  //    weight. This is where the moat lives: high-performing emails / posts
  //    rise in retrieval rank automatically.
  let patternRecorded = false;
  if (signal && input.document_id) {
    try {
      const r = await recordPattern({
        userId: input.userId,
        documentId: input.document_id,
        signal,
        clientId: input.client ?? null,
      });
      patternRecorded = r.ok;
    } catch (err) {
      console.warn("[outcomes] recordPattern failed:", err);
    }
  }

  // 2. Write a vault_decisions row tagged outcome_observed so the CEO brief
  //    has the event in its synthesis pool even when the doc link is absent.
  const title = input.title
    ?? defaultOutcomeTitle(input.source_kind, input.metric, input.value);
  const decisionResult = await recordDecision({
    userId: input.userId,
    client: input.client ?? null,
    decision_kind: "outcome_observed",
    title,
    source_kind: input.source_kind,
    source_id: input.source_id,
    document_id: input.document_id,
    scope: input.scope,
    impact: { metric: input.metric, value: input.value, signal },
  });

  return {
    ok: true,
    patternRecorded,
    signal: signal ?? undefined,
    decisionId: decisionResult.id,
  };
}

function defaultOutcomeTitle(source: string, metric: string, value: number): string {
  const human = metric.replace(/_/g, " ");
  return `[${source}] ${human}: ${formatValue(metric, value)}`;
}

function formatValue(metric: string, value: number): string {
  if (metric.endsWith("_rate")) return `${(value * 100).toFixed(1)}%`;
  return value.toString();
}

// ──────────────────────────────────────────────────────────────────────────
// recordDecision
// ──────────────────────────────────────────────────────────────────────────

export async function recordDecision(input: RecordDecisionInput): Promise<RecordDecisionResult> {
  if (!input.userId || !input.decision_kind || !input.title) {
    return { ok: false, reason: "missing_required_fields" };
  }
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/vault_decisions/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: input.userId,
        client: input.client ?? null,
        decision_kind: input.decision_kind,
        title: input.title,
        source_kind: input.source_kind ?? null,
        source_id: input.source_id ?? null,
        document_id: input.document_id ?? null,
        scope: input.scope ?? null,
        impact: input.impact ?? null,
        expires_at: input.expires_at ?? null,
        dismissed: false,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, reason: `pb_write_failed:${detail.slice(0, 200)}` };
    }
    const created = (await res.json()) as { id?: string };
    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Reads — used by CEO brief + Insights panel
// ──────────────────────────────────────────────────────────────────────────

export type DecisionRow = {
  id: string;
  user: string;
  client?: string | null;
  decision_kind: string;
  title: string;
  source_kind?: string | null;
  source_id?: string | null;
  document_id?: string | null;
  scope?: Record<string, unknown> | null;
  impact?: Record<string, unknown> | null;
  expires_at?: string | null;
  dismissed?: boolean;
  created: string;
};

/**
 * Fetch recent decisions + outcomes for a user. Used by:
 *   • CEO brief handler (Phase 5 — injects into user prompt)
 *   • Vault Insights panel (UI surface)
 */
export async function fetchRecentDecisions(
  userId: string,
  opts?: { daysBack?: number; limit?: number; includeDismissed?: boolean }
): Promise<DecisionRow[]> {
  if (!userId) return [];
  const daysBack = opts?.daysBack ?? 30;
  const limit = opts?.limit ?? 25;
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    const filterParts = [`user='${pbEscape(userId)}'`, `created>='${since}'`];
    if (!opts?.includeDismissed) filterParts.push(`dismissed!=true`);
    const filter = `(${filterParts.join(" && ")})`;
    const res = await fetch(
      `${url}/api/collections/vault_decisions/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=${limit}`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: DecisionRow[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}
