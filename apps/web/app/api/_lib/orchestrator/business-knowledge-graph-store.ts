import {
  createKnowledgeGraphEdge,
  createKnowledgeGraphNode,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
} from "./business-knowledge-graph";

export type StoredKnowledgeGraphNode = {
  graph_id: string;
  user: string;
  node_type: KnowledgeGraphNode["type"];
  label: string;
  properties: KnowledgeGraphNode["properties"];
  provenance: KnowledgeGraphNode["provenance"];
  confidence: number;
  effective_at: string | null;
  expires_at: string | null;
};

export type StoredKnowledgeGraphEdge = {
  graph_id: string;
  user: string;
  edge_type: KnowledgeGraphEdge["type"];
  from_node_id: string;
  to_node_id: string;
  properties: KnowledgeGraphEdge["properties"];
  provenance: KnowledgeGraphEdge["provenance"];
  confidence: number;
  effective_at: string | null;
  expires_at: string | null;
};

export function toStoredKnowledgeGraphNode(node: KnowledgeGraphNode): StoredKnowledgeGraphNode {
  const normalized = createKnowledgeGraphNode(node);
  return {
    graph_id: normalized.id,
    user: normalized.ownerId,
    node_type: normalized.type,
    label: normalized.label,
    properties: normalized.properties,
    provenance: normalized.provenance,
    confidence: normalized.confidence,
    effective_at: normalized.effectiveAt,
    expires_at: normalized.expiresAt,
  };
}

export function fromStoredKnowledgeGraphNode(record: StoredKnowledgeGraphNode): KnowledgeGraphNode {
  return createKnowledgeGraphNode({
    id: record.graph_id,
    ownerId: record.user,
    type: record.node_type,
    label: record.label,
    properties: record.properties,
    provenance: record.provenance,
    confidence: record.confidence,
    effectiveAt: record.effective_at,
    expiresAt: record.expires_at,
  });
}

export function toStoredKnowledgeGraphEdge(
  edge: KnowledgeGraphEdge,
  nodes: ReadonlyMap<string, KnowledgeGraphNode>,
): StoredKnowledgeGraphEdge {
  const normalized = createKnowledgeGraphEdge(edge, nodes);
  return {
    graph_id: normalized.id,
    user: normalized.ownerId,
    edge_type: normalized.type,
    from_node_id: normalized.fromNodeId,
    to_node_id: normalized.toNodeId,
    properties: normalized.properties,
    provenance: normalized.provenance,
    confidence: normalized.confidence,
    effective_at: normalized.effectiveAt,
    expires_at: normalized.expiresAt,
  };
}

export function fromStoredKnowledgeGraphEdge(
  record: StoredKnowledgeGraphEdge,
  nodes: ReadonlyMap<string, KnowledgeGraphNode>,
): KnowledgeGraphEdge {
  return createKnowledgeGraphEdge({
    id: record.graph_id,
    ownerId: record.user,
    type: record.edge_type,
    fromNodeId: record.from_node_id,
    toNodeId: record.to_node_id,
    properties: record.properties,
    provenance: record.provenance,
    confidence: record.confidence,
    effectiveAt: record.effective_at,
    expiresAt: record.expires_at,
  }, nodes);
}
