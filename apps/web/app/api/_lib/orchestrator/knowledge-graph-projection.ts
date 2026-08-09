import type { BusinessKnowledgeKind, BusinessKnowledgeRecord } from "./business-knowledge";
import { createKnowledgeGraphNode, type GraphProvenance, type KnowledgeGraphNode, type KnowledgeGraphNodeType } from "./business-knowledge-graph";
import type { MissionOutcomeRecord } from "./mission-memory";

const KNOWLEDGE_NODE_TYPE: Partial<Record<BusinessKnowledgeKind, KnowledgeGraphNodeType>> = {
  fact: "evidence",
  process: "process",
  policy: "policy",
  rule: "policy",
  preference: "policy",
  person: "person",
  role: "role",
  customer: "customer",
  product: "product",
  vendor: "vendor",
  document: "document",
  decision: "decision",
  exception: "policy",
  metric: "metric",
  risk: "risk",
  approval: "decision",
};

function graphTimestamp(value: string | null | undefined): string {
  const parsed = new Date(value ?? "");
  if (!Number.isFinite(parsed.getTime())) throw new Error("Graph projection requires a valid approval or observation timestamp");
  return parsed.toISOString();
}

function businessKnowledgeProvenance(record: BusinessKnowledgeRecord): GraphProvenance[] {
  return [{
    sourceType: "business_knowledge",
    sourceId: record.id,
    observedAt: graphTimestamp(record.approvedAt),
  }];
}

export function approvedKnowledgeToGraphNode(record: BusinessKnowledgeRecord): KnowledgeGraphNode {
  if (record.stage !== "approved" || !record.approvedBy || !record.approvedAt) {
    throw new Error("Only explicitly approved Business Brain knowledge can enter the Knowledge Graph");
  }
  if (record.supersededById) throw new Error("Superseded Business Brain knowledge cannot enter the active Knowledge Graph");
  const type = KNOWLEDGE_NODE_TYPE[record.kind];
  if (!type) throw new Error(`Unsupported Business Brain kind for graph projection: ${record.kind}`);
  return createKnowledgeGraphNode({
    id: `knowledge:${record.id}`,
    ownerId: record.ownerId,
    type,
    label: record.subject,
    properties: {
      knowledgeId: record.id,
      statement: record.statement,
      kind: record.kind,
      approvedBy: record.approvedBy,
      usageScopes: record.usageScopes.join(","),
      sourceCount: record.sources.length,
    },
    provenance: businessKnowledgeProvenance(record),
    confidence: record.confidence,
    effectiveAt: record.effectiveAt ?? null,
    expiresAt: record.expiresAt ?? null,
  });
}

export function approvedMissionOutcomeToGraphNode(record: MissionOutcomeRecord): KnowledgeGraphNode {
  if (!record.approvedForLearning || !record.approvedBy || !record.approvedAt) {
    throw new Error("Only owner-approved Mission Memory outcomes can enter the Knowledge Graph");
  }
  if (record.status === "inconclusive") {
    throw new Error("Inconclusive Mission Memory cannot enter the Knowledge Graph as learned outcome");
  }
  return createKnowledgeGraphNode({
    id: `outcome:${record.id}`,
    ownerId: record.ownerId,
    type: "outcome",
    label: record.actualOutcome,
    properties: {
      missionId: record.missionId,
      hypothesis: record.hypothesis,
      expectedOutcome: record.expectedOutcome,
      lesson: record.lesson,
      status: record.status,
      confidenceBefore: record.confidenceBefore,
      confidenceAfter: record.confidenceAfter,
      metricCount: record.metrics.length,
      approvedBy: record.approvedBy,
    },
    provenance: [{
      sourceType: "mission_memory",
      sourceId: record.id,
      observedAt: graphTimestamp(record.observedAt),
    }],
    confidence: record.confidenceAfter,
    effectiveAt: record.observedAt,
    expiresAt: null,
  });
}
