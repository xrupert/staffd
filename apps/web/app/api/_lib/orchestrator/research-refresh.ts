import type { ResearchCandidate, ResearchSearchResult } from "./research-retrieval";
import type { ResearchKnowledgeRecord } from "./research-reverification";

export type ResearchRefreshRecord = {
  user: string;
  bundle_id: string;
  topic: string;
  claim: string;
  label: "unknown";
  risk: ResearchKnowledgeRecord["risk"];
  verified_at: string;
  reverify_after: string;
  verdict: {
    answerable: false;
    confidence: "low";
    requiresHumanReview: true;
    reason: string;
  };
  citations: Array<ResearchCandidate & { relationship: "context_only" }>;
  answer: {
    supported: false;
    confidence: "low";
    statement: null;
    reason: string;
    requiresHumanReview: true;
  };
  review_status: "pending";
  reverify_status: "awaiting_classification";
  parent_record: string;
  refresh_query: string;
};

function stableRefreshId(parentId: string, retrievedAt: string): string {
  let hash = 2166136261;
  for (const character of `${parentId}:${retrievedAt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `research-refresh-${(hash >>> 0).toString(36)}`;
}

export function buildResearchRefreshRecord(
  parent: ResearchKnowledgeRecord,
  search: ResearchSearchResult,
  nextDeadline: string,
): ResearchRefreshRecord {
  if (!search.candidates.length) throw new Error("Fresh research returned no evidence candidates");
  if (!Number.isFinite(new Date(search.retrievedAt).getTime())) {
    throw new Error("Fresh research requires a valid retrieval timestamp");
  }

  const reason = "Fresh sources were retrieved, but their relationship to the approved claim must be classified before STAFFD may change trusted knowledge.";
  return {
    user: parent.user,
    bundle_id: stableRefreshId(parent.id, search.retrievedAt),
    topic: parent.topic,
    claim: parent.claim,
    label: "unknown",
    risk: parent.risk,
    verified_at: search.retrievedAt,
    reverify_after: nextDeadline,
    verdict: {
      answerable: false,
      confidence: "low",
      requiresHumanReview: true,
      reason,
    },
    citations: search.candidates.map((candidate) => ({ ...candidate, relationship: "context_only" })),
    answer: {
      supported: false,
      confidence: "low",
      statement: null,
      reason,
      requiresHumanReview: true,
    },
    review_status: "pending",
    reverify_status: "awaiting_classification",
    parent_record: parent.id,
    refresh_query: search.query,
  };
}
