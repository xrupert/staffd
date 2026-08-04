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
  actionPrompt?: string;
};

const PRIORITY_BY_URGENCY: Record<NonNullable<ExternalInboxSignal["urgency"]>, InboxPriority> = {
  urgent: "critical",
  important: "high",
  routine: "normal",
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function defaultActionPrompt(signal: ExternalInboxSignal, summary: string): string {
  switch (signal.kind) {
    case "customer_message":
      return `Review this unresolved customer conversation and prepare a helpful response for my approval: ${summary}`;
    case "lead_follow_up":
      return `Prepare the best next follow-up for this sales opportunity, including message copy and the recommended timing: ${summary}`;
    case "campaign_response":
      return `Analyze this campaign problem and prepare a concrete improvement plan with revised messaging or audience recommendations: ${summary}`;
    case "signature_request":
      return `Prepare a professional signature reminder and recommend the next escalation step for this document: ${summary}`;
    case "payment_issue":
      return `Investigate this payment issue, explain the likely cause, and prepare the safest recovery action for my approval: ${summary}`;
    case "integration_incident":
      return `Diagnose this business-system connection issue and prepare a safe repair plan: ${summary}`;
  }
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
  const actionPrompt = normalizeText(signal.actionPrompt ?? defaultActionPrompt(signal, summary));

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
    actionPrompt,
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
