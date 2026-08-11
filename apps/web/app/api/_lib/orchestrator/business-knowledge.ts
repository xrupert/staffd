export const BUSINESS_KNOWLEDGE_KINDS = [
  "fact",
  "process",
  "policy",
  "rule",
  "preference",
  "person",
  "role",
  "customer",
  "product",
  "vendor",
  "document",
  "decision",
  "exception",
  "metric",
  "risk",
  "approval",
] as const;

export type BusinessKnowledgeKind = (typeof BUSINESS_KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_STAGES = ["observed", "inferred", "learned", "approved"] as const;
export type KnowledgeStage = (typeof KNOWLEDGE_STAGES)[number];
export const KNOWLEDGE_REVIEW_STATUSES = ["pending", "approved", "rejected", "superseded"] as const;
export type KnowledgeReviewStatus = (typeof KNOWLEDGE_REVIEW_STATUSES)[number];

export type BusinessKnowledgeSource = {
  sourceId: string;
  sourceType: "owner" | "business_document" | "connected_system" | "external_authority" | "experiment";
  title: string;
  uri?: string;
  effectiveAt?: string | null;
  verifiedAt: string;
};

export type BusinessKnowledgeRecord = {
  id: string;
  ownerId: string;
  kind: BusinessKnowledgeKind;
  stage: KnowledgeStage;
  subject: string;
  statement: string;
  confidence: number;
  sources: BusinessKnowledgeSource[];
  usageScopes: string[];
  effectiveAt?: string | null;
  expiresAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  supersedesId?: string | null;
  supersededById?: string | null;
  reviewStatus?: KnowledgeReviewStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
};

export type OwnerKnowledgeDecision = "approve" | "reject" | "supersede";

export function reviewObservedKnowledge(
  record: BusinessKnowledgeRecord,
  decision: OwnerKnowledgeDecision,
  actorId: string,
  replacement?: { subject: string; statement: string },
  now = new Date(),
): { prior: BusinessKnowledgeRecord; approved?: BusinessKnowledgeRecord } {
  validateBusinessKnowledge(record);
  if (record.stage !== "observed" || (record.reviewStatus && record.reviewStatus !== "pending")) {
    throw new Error("Only pending observed knowledge can be reviewed");
  }
  if (!actorId) throw new Error("Owner identity is required to review knowledge");
  if (decision === "supersede" && (!replacement?.subject.trim() || !replacement.statement.trim())) {
    throw new Error("Replacement subject and statement are required");
  }

  const reviewedAt = now.toISOString();
  if (decision === "reject") {
    return { prior: { ...record, reviewStatus: "rejected", reviewedBy: actorId, reviewedAt } };
  }

  const approved: BusinessKnowledgeRecord = {
    ...record,
    id: "pending",
    stage: "approved",
    subject: replacement?.subject.trim() || record.subject,
    statement: replacement?.statement.trim() || record.statement,
    approvedBy: actorId,
    approvedAt: reviewedAt,
    reviewStatus: "approved",
    reviewedBy: actorId,
    reviewedAt,
    supersedesId: record.id,
    supersededById: null,
  };
  validateBusinessKnowledge(approved);
  return {
    prior: {
      ...record,
      reviewStatus: decision === "supersede" ? "superseded" : "approved",
      reviewedBy: actorId,
      reviewedAt,
    },
    approved,
  };
}

export type PromotionEvidence = {
  independentSourceCount: number;
  repeatedObservationCount: number;
  hasContradiction: boolean;
  ownerApproved: boolean;
};

const NEXT_STAGE: Partial<Record<KnowledgeStage, KnowledgeStage>> = {
  observed: "inferred",
  inferred: "learned",
  learned: "approved",
};

export function validateBusinessKnowledge(record: BusinessKnowledgeRecord): void {
  if (!record.id || !record.ownerId) throw new Error("Knowledge identity and owner are required");
  if (!record.subject.trim() || !record.statement.trim()) throw new Error("Knowledge subject and statement are required");
  if (record.confidence < 0 || record.confidence > 1) throw new Error("Knowledge confidence must be between 0 and 1");
  if (record.sources.length === 0) throw new Error("Knowledge requires provenance");
  if (record.usageScopes.length === 0) throw new Error("Knowledge requires at least one usage scope");
  if (record.stage === "approved" && (!record.approvedBy || !record.approvedAt)) {
    throw new Error("Approved knowledge requires approver identity and timestamp");
  }
  if (record.supersedesId && record.supersededById) {
    throw new Error("A knowledge record cannot simultaneously supersede and be superseded");
  }
  if (record.reviewStatus && !KNOWLEDGE_REVIEW_STATUSES.includes(record.reviewStatus)) {
    throw new Error("Knowledge review status is invalid");
  }
}

export function promoteKnowledge(
  record: BusinessKnowledgeRecord,
  evidence: PromotionEvidence,
  actorId?: string,
  now = new Date(),
): BusinessKnowledgeRecord {
  validateBusinessKnowledge(record);
  const nextStage = NEXT_STAGE[record.stage];
  if (!nextStage) throw new Error("Approved knowledge cannot be promoted further");
  if (evidence.hasContradiction) throw new Error("Contradicted knowledge cannot be promoted");

  if (nextStage === "inferred" && evidence.independentSourceCount < 1) {
    throw new Error("Inference requires supporting evidence");
  }
  if (nextStage === "learned" && (evidence.independentSourceCount < 2 || evidence.repeatedObservationCount < 3)) {
    throw new Error("Learned knowledge requires repeated, independently supported evidence");
  }
  if (nextStage === "approved" && (!evidence.ownerApproved || !actorId)) {
    throw new Error("Durable business knowledge requires explicit owner approval");
  }

  return {
    ...record,
    stage: nextStage,
    approvedBy: nextStage === "approved" ? actorId : record.approvedBy,
    approvedAt: nextStage === "approved" ? now.toISOString() : record.approvedAt,
  };
}

export function supersedeKnowledge(
  prior: BusinessKnowledgeRecord,
  replacement: BusinessKnowledgeRecord,
): { prior: BusinessKnowledgeRecord; replacement: BusinessKnowledgeRecord } {
  validateBusinessKnowledge(prior);
  validateBusinessKnowledge(replacement);
  if (prior.ownerId !== replacement.ownerId) throw new Error("Knowledge cannot cross owner boundaries");
  if (prior.id === replacement.id) throw new Error("Replacement knowledge must be a new immutable record");
  if (replacement.stage !== "approved") throw new Error("Only approved knowledge can supersede approved knowledge");
  return {
    prior: { ...prior, supersededById: replacement.id },
    replacement: { ...replacement, supersedesId: prior.id },
  };
}
