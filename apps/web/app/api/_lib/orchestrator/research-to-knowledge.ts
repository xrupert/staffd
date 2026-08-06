import type { BusinessKnowledgeRecord, BusinessKnowledgeKind } from "./business-knowledge";
import type { ResearchRecord } from "./research-records";

export type ResearchKnowledgeInput = {
  research: ResearchRecord & { id: string };
  kind: BusinessKnowledgeKind;
  usageScopes: string[];
};

export function approvedResearchToKnowledge(input: ResearchKnowledgeInput): BusinessKnowledgeRecord {
  const { research, kind, usageScopes } = input;
  if (research.review_status !== "approved") {
    throw new Error("Only owner-approved research can enter approved business knowledge");
  }
  if (!research.reviewed_by || !research.reviewed_at) {
    throw new Error("Approved research requires reviewer identity and timestamp");
  }
  if (usageScopes.length === 0) throw new Error("Research knowledge requires a usage scope");

  return {
    id: "pending",
    ownerId: research.user,
    kind,
    stage: "approved",
    subject: research.topic,
    statement: research.claim,
    confidence: research.verdict.confidence === "high" ? 0.95 : research.verdict.confidence === "medium" ? 0.75 : 0.55,
    sources: [{
      sourceId: research.id,
      sourceType: "external_authority",
      title: `Verified research: ${research.topic}`,
      uri: `research://${research.id}`,
      effectiveAt: research.verified_at,
      verifiedAt: research.verified_at,
    }],
    usageScopes,
    effectiveAt: research.verified_at,
    expiresAt: research.reverify_after,
    approvedBy: research.reviewed_by,
    approvedAt: research.reviewed_at,
  };
}
