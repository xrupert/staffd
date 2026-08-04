import { resolveCredentials, type ResolveUser, type Resolved } from "../integrations/resolve";
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

type ListmonkCampaign = {
  id?: number;
  name?: string;
  status?: string;
  sent?: number;
  views?: number;
  clicks?: number;
  bounces?: number;
  created_at?: string;
};

type DocusealSubmitter = {
  status?: string;
  email?: string;
  name?: string;
};

type DocusealSubmission = {
  id?: number | string;
  name?: string;
  status?: string;
  created_at?: string;
  submitters?: DocusealSubmitter[];
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

function campaignRates(campaign: ListmonkCampaign): { openRate: number; bounceRate: number } {
  const sent = Math.max(0, campaign.sent ?? 0);
  if (sent === 0) return { openRate: 0, bounceRate: 0 };
  return {
    openRate: ((campaign.views ?? 0) / sent) * 100,
    bounceRate: ((campaign.bounces ?? 0) / sent) * 100,
  };
}

export function listmonkCampaignNeedsAttention(campaign: ListmonkCampaign): boolean {
  const status = (campaign.status ?? "").toLowerCase();
  const sent = campaign.sent ?? 0;
  if (sent < 50 || ["draft", "scheduled", "cancelled"].includes(status)) return false;
  const { openRate, bounceRate } = campaignRates(campaign);
  return openRate < 15 || bounceRate >= 5;
}

const listmonkAdapter: InboxSourceAdapter<ListmonkCampaign> = {
  id: "listmonk-campaign-performance",
  normalize(campaign) {
    if (!campaign.id || !listmonkCampaignNeedsAttention(campaign)) return null;
    const occurredAt = campaign.created_at && Number.isFinite(new Date(campaign.created_at).getTime())
      ? new Date(campaign.created_at).toISOString()
      : new Date().toISOString();
    const { openRate, bounceRate } = campaignRates(campaign);
    const bounceProblem = bounceRate >= 5;

    return {
      provider: "listmonk",
      sourceId: String(campaign.id),
      kind: "campaign_response",
      title: bounceProblem ? "An email campaign has a delivery problem" : "An email campaign is underperforming",
      summary: campaign.name?.trim() || "A recent email campaign needs review.",
      occurredAt,
      urgency: bounceProblem && bounceRate >= 10 ? "urgent" : "important",
      evidence: [
        `${Math.round(openRate)}% open rate`,
        `${Math.round(bounceRate)}% bounce rate`,
        `${campaign.clicks ?? 0} clicks`,
      ],
      actionLabel: "Improve the campaign",
      actionHref: "/dashboard/marketing",
    };
  },
};

const TERMINAL_SIGNATURE_STATES = new Set(["completed", "declined", "cancelled", "expired"]);

export function docusealSubmissionNeedsReminder(
  submission: DocusealSubmission,
  now = new Date(),
): boolean {
  const state = (submission.status ?? "pending").toLowerCase();
  if (TERMINAL_SIGNATURE_STATES.has(state)) return false;
  if (!submission.created_at) return false;
  const created = new Date(submission.created_at);
  if (!Number.isFinite(created.getTime())) return false;
  return now.getTime() - created.getTime() >= 3 * 24 * 60 * 60 * 1000;
}

const docusealAdapter: InboxSourceAdapter<DocusealSubmission> = {
  id: "docuseal-pending-signatures",
  normalize(submission) {
    if (submission.id == null || !docusealSubmissionNeedsReminder(submission)) return null;
    const created = new Date(submission.created_at!);
    const ageDays = Math.max(3, Math.floor((Date.now() - created.getTime()) / 86_400_000));
    const pendingSigner = submission.submitters?.find((submitter) => {
      const state = (submitter.status ?? "pending").toLowerCase();
      return !TERMINAL_SIGNATURE_STATES.has(state) && state !== "signed";
    });
    const signer = pendingSigner?.name?.trim() || pendingSigner?.email?.trim() || "A signer";

    return {
      provider: "docuseal",
      sourceId: String(submission.id),
      kind: "signature_request",
      title: ageDays >= 7 ? "A signature request is overdue" : "A document is still waiting for signature",
      summary: `${signer} has not completed ${submission.name?.trim() || "a document"}.`,
      occurredAt: created.toISOString(),
      urgency: ageDays >= 7 ? "important" : "routine",
      evidence: [`Waiting ${ageDays} days`, `Current status: ${submission.status ?? "pending"}`],
      actionLabel: "Prepare a reminder",
      actionHref: "/dashboard/legal",
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

function listmonkHeaders(credentials: Resolved): Record<string, string> {
  const username = String(credentials.config.username || "listmonk");
  const auth = Buffer.from(`${username}:${credentials.key}`).toString("base64");
  return { "Content-Type": "application/json", Authorization: `Basic ${auth}` };
}

async function listListmonkCampaigns(user: ResolveUser): Promise<ListmonkCampaign[]> {
  const credentials = await resolveCredentials(user, "listmonk");
  if (!credentials) return [];
  const response = await fetch(
    `${credentials.url.replace(/\/$/, "")}/api/campaigns?page=1&per_page=20&order_by=created_at&order=DESC`,
    { headers: listmonkHeaders(credentials), cache: "no-store" },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: { results?: ListmonkCampaign[] } };
  return payload.data?.results ?? [];
}

async function listDocusealSubmissions(user: ResolveUser): Promise<DocusealSubmission[]> {
  const credentials = await resolveCredentials(user, "docuseal");
  if (!credentials) return [];
  const response = await fetch(`${credentials.url.replace(/\/$/, "")}/api/submissions?limit=50`, {
    headers: { "Content-Type": "application/json", "X-Auth-Token": credentials.key },
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as
    | DocusealSubmission[]
    | { data?: DocusealSubmission[]; submissions?: DocusealSubmission[] };
  if (Array.isArray(payload)) return payload;
  return payload.data ?? payload.submissions ?? [];
}

export async function liveIntegrationInboxItems(user: ResolveUser): Promise<BusinessInboxItem[]> {
  const [conversations, opportunities, campaigns, submissions] = await Promise.all([
    listChatwootConversations(user).catch(() => []),
    listTwentyOpportunities(user).catch(() => []),
    listListmonkCampaigns(user).catch(() => []),
    listDocusealSubmissions(user).catch(() => []),
  ]);

  return [
    ...adaptInboxSource(chatwootAdapter, conversations),
    ...adaptInboxSource(twentyAdapter, opportunities),
    ...adaptInboxSource(listmonkAdapter, campaigns),
    ...adaptInboxSource(docusealAdapter, submissions),
  ];
}
