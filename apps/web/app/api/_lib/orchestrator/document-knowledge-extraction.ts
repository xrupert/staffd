import {
  BUSINESS_KNOWLEDGE_KINDS,
  validateBusinessKnowledge,
  type BusinessKnowledgeKind,
  type BusinessKnowledgeRecord,
} from "./business-knowledge";

export type DocumentKnowledgeCandidate = {
  kind: BusinessKnowledgeKind;
  subject: string;
  statement: string;
  confidence: number;
  usageScopes: string[];
  sourceLocation?: string | null;
  effectiveAt?: string | null;
};

export type BusinessDocumentSource = {
  id: string;
  ownerId: string;
  title: string;
  uri: string;
  uploadedAt: string;
};

const KIND_SET = new Set<string>(BUSINESS_KNOWLEDGE_KINDS);

function clean(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Document timestamp is invalid");
  return parsed.toISOString();
}

export function documentCandidateToObservation(
  source: BusinessDocumentSource,
  candidate: DocumentKnowledgeCandidate,
): BusinessKnowledgeRecord {
  const sourceId = clean(source.id, 200);
  const ownerId = clean(source.ownerId, 200);
  const title = clean(source.title, 300);
  const uri = source.uri.trim();
  if (!sourceId || !ownerId || !title || !uri) throw new Error("Document source identity is incomplete");
  if (!KIND_SET.has(candidate.kind)) throw new Error("Document candidate kind is invalid");
  if (candidate.confidence < 0 || candidate.confidence > 1) {
    throw new Error("Document candidate confidence must be between 0 and 1");
  }
  const usageScopes = [...new Set(candidate.usageScopes.map((scope) => clean(scope, 100)).filter(Boolean))];
  if (usageScopes.length === 0) throw new Error("Document candidate requires a usage scope");

  const verifiedAt = validDate(source.uploadedAt);
  const record: BusinessKnowledgeRecord = {
    id: "pending",
    ownerId,
    kind: candidate.kind,
    stage: "observed",
    subject: clean(candidate.subject, 500),
    statement: clean(candidate.statement, 4_000),
    confidence: candidate.confidence,
    sources: [{
      sourceId,
      sourceType: "business_document",
      title,
      uri,
      effectiveAt: candidate.effectiveAt ?? null,
      verifiedAt,
    }],
    usageScopes,
    effectiveAt: candidate.effectiveAt ?? null,
  };
  validateBusinessKnowledge(record);
  return record;
}

export function documentCandidatesToObservations(
  source: BusinessDocumentSource,
  candidates: DocumentKnowledgeCandidate[],
): BusinessKnowledgeRecord[] {
  if (candidates.length === 0) throw new Error("Document extraction returned no knowledge candidates");
  if (candidates.length > 100) throw new Error("Document extraction exceeds the candidate limit");
  return candidates.map((candidate) => documentCandidateToObservation(source, candidate));
}
