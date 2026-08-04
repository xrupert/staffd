export type StaffCapability =
  | "crm.read"
  | "crm.write"
  | "support.read"
  | "support.reply"
  | "email.read"
  | "email.send"
  | "analytics.read"
  | "signature.send"
  | "social.publish"
  | "media.produce";

export type StaffOutcomeId =
  | "follow-up-warm-leads"
  | "launch-email-campaign"
  | "clear-support-inbox"
  | "review-business-performance"
  | "send-document-for-signature"
  | "publish-social-campaign"
  | "produce-viral-video";

export type StaffOutcome = {
  id: StaffOutcomeId;
  title: string;
  userPromise: string;
  exampleRequest: string;
  capabilities: StaffCapability[];
  requiresApproval: boolean;
  packAware: boolean;
  evidence: string[];
};

export const STAFF_OUTCOMES: readonly StaffOutcome[] = [
  {
    id: "follow-up-warm-leads",
    title: "Follow up with warm leads",
    userPromise: "Find the people most likely to buy and prepare the next best follow-up.",
    exampleRequest: "Follow up with every warm lead who has gone quiet this week.",
    capabilities: ["crm.read", "crm.write", "email.send"],
    requiresApproval: true,
    packAware: true,
    evidence: ["lead list", "follow-up drafts", "delivery status"],
  },
  {
    id: "launch-email-campaign",
    title: "Launch an email campaign",
    userPromise: "Create, review, send, and measure a campaign for the right audience.",
    exampleRequest: "Launch a promotion for my slowest weekday.",
    capabilities: ["crm.read", "email.read", "email.send", "analytics.read"],
    requiresApproval: true,
    packAware: true,
    evidence: ["audience", "campaign draft", "approval", "send results"],
  },
  {
    id: "clear-support-inbox",
    title: "Clear the support inbox",
    userPromise: "Prioritize customer messages and prepare accurate replies for approval.",
    exampleRequest: "Handle the urgent customer questions from today.",
    capabilities: ["support.read", "support.reply"],
    requiresApproval: true,
    packAware: true,
    evidence: ["priority queue", "reply drafts", "resolved conversations"],
  },
  {
    id: "review-business-performance",
    title: "Review business performance",
    userPromise: "Explain what changed, why it matters, and what the business should do next.",
    exampleRequest: "Tell me what is working and what needs attention this week.",
    capabilities: ["analytics.read", "crm.read", "email.read", "support.read"],
    requiresApproval: false,
    packAware: true,
    evidence: ["source metrics", "findings", "recommended actions"],
  },
  {
    id: "send-document-for-signature",
    title: "Send a document for signature",
    userPromise: "Prepare the right document, verify the recipient, and request approval before sending.",
    exampleRequest: "Send this agreement to the client for signature.",
    capabilities: ["signature.send", "crm.read"],
    requiresApproval: true,
    packAware: true,
    evidence: ["document", "recipient", "approval", "signature status"],
  },
  {
    id: "publish-social-campaign",
    title: "Publish a social campaign",
    userPromise: "Turn an approved campaign into scheduled posts across the right channels.",
    exampleRequest: "Schedule this campaign for the next two weeks.",
    capabilities: ["social.publish", "analytics.read"],
    requiresApproval: true,
    packAware: true,
    evidence: ["content plan", "approval", "publishing schedule", "performance"],
  },
  {
    id: "produce-viral-video",
    title: "Produce a viral-ready video",
    userPromise: "Develop the hook, script, visuals, complete edit, and evidence-based quality check.",
    exampleRequest: "Make a viral video for my product launch.",
    capabilities: ["media.produce", "analytics.read"],
    requiresApproval: true,
    packAware: true,
    evidence: ["creative brief", "script", "render", "quality grade", "final approval"],
  },
] as const;

export function outcomeById(id: StaffOutcomeId): StaffOutcome {
  const outcome = STAFF_OUTCOMES.find((candidate) => candidate.id === id);

  if (!outcome) {
    throw new Error(`Unknown staff outcome: ${id}`);
  }

  return outcome;
}

export function outcomesForCapabilities(
  availableCapabilities: ReadonlySet<StaffCapability>,
): StaffOutcome[] {
  return STAFF_OUTCOMES.filter((outcome) =>
    outcome.capabilities.every((capability) => availableCapabilities.has(capability)),
  );
}
