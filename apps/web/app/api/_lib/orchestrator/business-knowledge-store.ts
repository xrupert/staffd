import type { BusinessKnowledgeRecord } from "./business-knowledge";

export type StoredBusinessKnowledge = {
  id: string;
  user: string;
  kind: BusinessKnowledgeRecord["kind"];
  stage: BusinessKnowledgeRecord["stage"];
  subject: string;
  statement: string;
  confidence: number;
  sources: BusinessKnowledgeRecord["sources"];
  usage_scopes: string[];
  effective_at?: string | null;
  expires_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  supersedes_id?: string | null;
  superseded_by_id?: string | null;
  review_status?: BusinessKnowledgeRecord["reviewStatus"];
  reviewed_by?: string | null;
  reviewed_at?: string | null;
};

export function toStoredBusinessKnowledge(record: BusinessKnowledgeRecord): Omit<StoredBusinessKnowledge, "id"> {
  return {
    user: record.ownerId,
    kind: record.kind,
    stage: record.stage,
    subject: record.subject,
    statement: record.statement,
    confidence: record.confidence,
    sources: record.sources,
    usage_scopes: record.usageScopes,
    effective_at: record.effectiveAt ?? null,
    expires_at: record.expiresAt ?? null,
    approved_by: record.approvedBy ?? null,
    approved_at: record.approvedAt ?? null,
    supersedes_id: record.supersedesId ?? null,
    superseded_by_id: record.supersededById ?? null,
    review_status: record.reviewStatus ?? (record.stage === "approved" ? "approved" : "pending"),
    reviewed_by: record.reviewedBy ?? null,
    reviewed_at: record.reviewedAt ?? null,
  };
}

export function fromStoredBusinessKnowledge(record: StoredBusinessKnowledge): BusinessKnowledgeRecord {
  return {
    id: record.id,
    ownerId: record.user,
    kind: record.kind,
    stage: record.stage,
    subject: record.subject,
    statement: record.statement,
    confidence: record.confidence,
    sources: record.sources,
    usageScopes: record.usage_scopes,
    effectiveAt: record.effective_at ?? null,
    expiresAt: record.expires_at ?? null,
    approvedBy: record.approved_by ?? null,
    approvedAt: record.approved_at ?? null,
    supersedesId: record.supersedes_id ?? null,
    supersededById: record.superseded_by_id ?? null,
    ...(record.review_status ? { reviewStatus: record.review_status } : {}),
    ...(record.reviewed_by ? { reviewedBy: record.reviewed_by } : {}),
    ...(record.reviewed_at ? { reviewedAt: record.reviewed_at } : {}),
  };
}
