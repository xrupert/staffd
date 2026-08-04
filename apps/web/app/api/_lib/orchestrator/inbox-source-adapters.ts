import type { BusinessInboxItem, InboxPriority } from "./business-inbox";

export type ExternalInboxSignalKind =
  | "customer_message"
  | "lead_follow_up"
  | "campaign_response"
  | "signature_request"
  | "payment_issue"
  | "integration_incident";

export type ExternalInboxSignal = {
  provider: string;
  sourceId: string;
  kind: ExternalInboxSignalKind;
  title: string;
  summary: string;
  occurredAt: string;
  urgency?: "urgent" | "important" | "routine";
  evidence?: string[];
  actionLabel: string;
  actionHref: string;
};

const PRIORITY_BY_URGENCY: Record<NonNullable<ExternalInboxSignal["urgency"]>, InboxPriority> = {
  urgent: "critical",
  important: "high",
  routine: "normal",
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function externalInboxItem(signal: ExternalInboxSignal): BusinessInboxItem | null {
  const sourceId = normalizeText(signal.sourceId);
  const title = normalizeText(signal.title);
  const summary = normalizeText(signal.summary);
  const actionLabel = normalizeText(signal.actionLabel);
  const actionHref = signal.actionHref.trim();
  const occurredAt = new Date(signal.occurredAt);

  if (!sourceId || !title || !summary || !actionLabel || !actionHref) return null;
  if (!Number.isFinite(occurredAt.getTime())) return null;

  const provider = normalizeText(signal.provider).toLowerCase() || "integration";

  return {
    id: `integration:${provider}:${signal.kind}:${sourceId}`,
    source: "integration",
    sourceId,
    kind: "incoming",
    priority: PRIORITY_BY_URGENCY[signal.urgency ?? "routine"],
    title,
    summary,
    evidence: (signal.evidence ?? []).map(normalizeText).filter(Boolean),
    actionLabel,
    actionHref,
    occurredAt: occurredAt.toISOString(),
  };
}

export type InboxSourceAdapter<T> = {
  id: string;
  normalize: (record: T) => ExternalInboxSignal | null;
};

export function adaptInboxSource<T>(adapter: InboxSourceAdapter<T>, records: T[]): BusinessInboxItem[] {
  const items: BusinessInboxItem[] = [];

  for (const record of records) {
    const signal = adapter.normalize(record);
    if (!signal) continue;
    const item = externalInboxItem(signal);
    if (item) items.push(item);
  }

  return items;
}
