import { resolveCredentials, type ResolveUser } from "../integrations/resolve";
import { adaptInboxSource, type InboxSourceAdapter } from "./inbox-source-adapters";
import type { BusinessInboxItem } from "./business-inbox";

type ChatwootConversation = {
  id: number;
  status?: string;
  last_activity_at?: number;
  meta?: { sender?: { name?: string; email?: string } };
};

type TwentyOpportunity = {
  id: string;
  name: string;
  stage?: string | null;
  createdAt?: string | null;
};

const chatwootAdapter: InboxSourceAdapter<ChatwootConversation> = {
  id: "chatwoot-open-conversations",
  normalize(conversation) {
    if (conversation.status && conversation.status !== "open") return null;
    const occurredAt = conversation.last_activity_at
      ? new Date(conversation.last_activity_at * 1000).toISOString()
      : new Date(0).toISOString();
    const ageHours = Math.max(0, (Date.now() - new Date(occurredAt).getTime()) / 3_600_000);
    const contact = conversation.meta?.sender?.name?.trim()
      || conversation.meta?.sender?.email?.trim()
      || "A customer";

    return {
      provider: "chatwoot",
      sourceId: String(conversation.id),
      kind: "customer_message",
      title: ageHours >= 24 ? "A customer has been waiting" : "A customer needs a response",
      summary: `${contact} has an unresolved support conversation.`,
      occurredAt,
      urgency: ageHours >= 24 ? "urgent" : "important",
      evidence: [ageHours >= 1 ? `${Math.floor(ageHours)} hours since the last activity` : "Recent customer activity"],
      actionLabel: "Review the conversation",
      actionHref: "/dashboard/reputation",
    };
  },
};

const CLOSED_STAGES = new Set(["CLOSED_WON", "CLOSED_LOST", "WON", "LOST"]);

export function twentyOpportunityNeedsFollowUp(
  opportunity: TwentyOpportunity,
  now = new Date(),
): boolean {
  if (!opportunity.createdAt) return false;
  if (opportunity.stage && CLOSED_STAGES.has(opportunity.stage.toUpperCase())) return false;
  const created = new Date(opportunity.createdAt);
  if (!Number.isFinite(created.getTime())) return false;
  return now.getTime() - created.getTime() >= 7 * 24 * 60 * 60 * 1000;
}

const twentyAdapter: InboxSourceAdapter<TwentyOpportunity> = {
  id: "twenty-overdue-follow-ups",
  normalize(opportunity) {
    if (!twentyOpportunityNeedsFollowUp(opportunity)) return null;
    const created = new Date(opportunity.createdAt!);
    const ageDays = Math.max(7, Math.floor((Date.now() - created.getTime()) / 86_400_000));

    return {
      provider: "twenty",
      sourceId: opportunity.id,
      kind: "lead_follow_up",
      title: ageDays >= 14 ? "A sales opportunity is going cold" : "A lead needs follow-up",
      summary: opportunity.name,
      occurredAt: created.toISOString(),
      urgency: ageDays >= 14 ? "important" : "routine",
      evidence: [
        `${ageDays} days since the opportunity was created`,
        opportunity.stage ? `Current stage: ${opportunity.stage}` : "No stage recorded",
      ],
      actionLabel: "Plan the follow-up",
      actionHref: "/dashboard/sales",
    };
  },
};

async function listChatwootConversations(user: ResolveUser): Promise<ChatwootConversation[]> {
  const credentials = await resolveCredentials(user, "chatwoot");
  const accountId = credentials?.config.account_id;
  if (!credentials || !accountId) return [];

  const response = await fetch(
    `${credentials.url.replace(/\/$/, "")}/api/v1/accounts/${String(accountId)}/conversations?status=open&assignee_type=all`,
    {
      headers: {
        "Content-Type": "application/json",
        api_access_token: credentials.key,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    data?: { payload?: ChatwootConversation[] };
    payload?: ChatwootConversation[];
  };
  return payload.data?.payload ?? payload.payload ?? [];
}

async function listTwentyOpportunities(user: ResolveUser): Promise<TwentyOpportunity[]> {
  const credentials = await resolveCredentials(user, "twenty");
  if (!credentials) return [];

  const response = await fetch(`${credentials.url.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.key}`,
    },
    body: JSON.stringify({
      query: "query { opportunities(first: 50) { edges { node { id name stage createdAt } } } }",
    }),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    data?: { opportunities?: { edges?: Array<{ node: TwentyOpportunity }> } };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) return [];
  return (payload.data?.opportunities?.edges ?? []).map(({ node }) => node);
}

export async function liveIntegrationInboxItems(user: ResolveUser): Promise<BusinessInboxItem[]> {
  const [conversations, opportunities] = await Promise.all([
    listChatwootConversations(user).catch(() => []),
    listTwentyOpportunities(user).catch(() => []),
  ]);

  return [
    ...adaptInboxSource(chatwootAdapter, conversations),
    ...adaptInboxSource(twentyAdapter, opportunities),
  ];
}
