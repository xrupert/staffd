import type { BusinessKnowledgeRecord } from "./business-knowledge";
import { createKnowledgeGraphEdge, createKnowledgeGraphNode, type KnowledgeGraphEdge, type KnowledgeGraphNode } from "./business-knowledge-graph";
import type { MissionOutcomeRecord } from "./mission-memory";

export function projectApprovedBusinessKnowledge(record: BusinessKnowledgeRecord): KnowledgeGraphNode {
  if (record.stage !== "approved" || !record.approvedBy || !record.approvedAt) {
    throw new Error("Only explicitly approved Business Brain knowledge may enter the Knowledge Graph");
  }
  if (record.supersededById) throw new Error("Superseded Business Brain knowledge may not be projected as current graph knowledge");

  return createKnowledgeGraphNode({
    id: `knowledge:${record.id}`,
    ownerId: record.ownerId,
    type: record.kind,
    label: record.subject,
    properties: {
      statement: record.statement,
      stage: record.stage,
      usageScopes: record.usageScopes.join(","),
      approvedBy: record.approvedBy,
    },
    provenance: record.sources.map((source) => ({
      sourceType: "business_knowledge" as const,
      sourceId: `${record.id}:${source.sourceId}`,
      observedAt: source.verifiedAt,
    })),
    confidence: record.confidence,
    effectiveAt: record.effectiveAt ?? record.approvedAt,
    expiresAt: record.expiresAt ?? null,
  });
}

export function projectApprovedMissionOutcome(record: MissionOutcomeRecord): {
  nodes: [KnowledgeGraphNode, KnowledgeGraphNode];
  edges: [KnowledgeGraphEdge];
} {
  if (!record.approvedForLearning || !record.approvedBy || !record.approvedAt) {
    throw new Error("Only explicitly approved Mission Memory may enter the Knowledge Graph");
  }
  if (record.status === "inconclusive") {
    throw new Error("Inconclusive Mission Memory may not become graph learning");
  }

  const mission = createKnowledgeGraphNode({
    id: `mission:${record.missionId}`,
    ownerId: record.ownerId,
    type: "mission",
    label: record.missionId,
    properties: {},
    provenance: [{ sourceType: "mission_memory", sourceId: record.id, observedAt: record.observedAt }],
    confidence: record.confidenceAfter,
    effectiveAt: record.observedAt,
    expiresAt: null,
  });
  const outcome = createKnowledgeGraphNode({
    id: `outcome:${record.id}`,
    ownerId: record.ownerId,
    type: "outcome",
    label: record.actualOutcome,
    properties: {
      hypothesis: record.hypothesis,
      expectedOutcome: record.expectedOutcome,
      actualOutcome: record.actualOutcome,
      status: record.status,
      lesson: record.lesson,
      confidenceBefore: record.confidenceBefore,
      confidenceAfter: record.confidenceAfter,
      approvedBy: record.approvedBy,
    },
    provenance: [{ sourceType: "mission_memory", sourceId: record.id, observedAt: record.observedAt }],
    confidence: record.confidenceAfter,
    effectiveAt: record.observedAt,
    expiresAt: null,
  });
  const nodeMap = new Map([[mission.id, mission], [outcome.id, outcome]]);
  const produced = createKnowledgeGraphEdge({
    id: `edge:${record.missionId}:produced:${record.id}`,
    ownerId: record.ownerId,
    type: "produced",
    fromNodeId: mission.id,
    toNodeId: outcome.id,
    properties: { approvedForLearning: true },
    provenance: [{ sourceType: "mission_memory", sourceId: record.id, observedAt: record.approvedAt }],
    confidence: record.confidenceAfter,
    effectiveAt: record.approvedAt,
    expiresAt: null,
  }, nodeMap);

  return { nodes: [mission, outcome], edges: [produced] };
}
