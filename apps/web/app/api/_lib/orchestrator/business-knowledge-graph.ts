export type KnowledgeGraphNodeType =
  | "business"
  | "person"
  | "role"
  | "customer"
  | "product"
  | "vendor"
  | "policy"
  | "process"
  | "decision"
  | "metric"
  | "risk"
  | "mission"
  | "evidence"
  | "outcome"
  | "experiment"
  | "document"
  | "integration";

export type KnowledgeGraphEdgeType =
  | "owns"
  | "performs"
  | "serves"
  | "supplies"
  | "governed_by"
  | "implements"
  | "derived_from"
  | "supports"
  | "contradicts"
  | "depends_on"
  | "measured_by"
  | "mitigates"
  | "produced"
  | "affects"
  | "supersedes"
  | "approved_by"
  | "learned_from"
  | "related_to";

export type GraphProvenance = {
  sourceType: "business_knowledge" | "mission_memory" | "research" | "document" | "system";
  sourceId: string;
  observedAt: string;
};

export type KnowledgeGraphNode = {
  id: string;
  ownerId: string;
  type: KnowledgeGraphNodeType;
  label: string;
  properties: Record<string, string | number | boolean | null>;
  provenance: GraphProvenance[];
  confidence: number;
  effectiveAt: string | null;
  expiresAt: string | null;
};

export type KnowledgeGraphEdge = {
  id: string;
  ownerId: string;
  type: KnowledgeGraphEdgeType;
  fromNodeId: string;
  toNodeId: string;
  properties: Record<string, string | number | boolean | null>;
  provenance: GraphProvenance[];
  confidence: number;
  effectiveAt: string | null;
  expiresAt: string | null;
};

function clean(value: string, label: string, maxLength = 500): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized.slice(0, maxLength);
}

function validateTimestamp(value: string | null, label: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed.toISOString();
}

function validateConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Graph confidence must be between 0 and 1");
  return value;
}

function normalizeProvenance(items: GraphProvenance[]): GraphProvenance[] {
  if (!items.length) throw new Error("Knowledge graph records require provenance");
  const seen = new Set<string>();
  return items.map((item) => {
    const sourceId = clean(item.sourceId, "Graph provenance source", 300);
    const observedAt = validateTimestamp(item.observedAt, "Graph provenance timestamp");
    if (!observedAt) throw new Error("Graph provenance timestamp is required");
    const key = `${item.sourceType}:${sourceId}:${observedAt}`;
    if (seen.has(key)) throw new Error("Knowledge graph provenance entries must be unique");
    seen.add(key);
    return { sourceType: item.sourceType, sourceId, observedAt };
  });
}

export function createKnowledgeGraphNode(input: KnowledgeGraphNode): KnowledgeGraphNode {
  const ownerId = clean(input.ownerId, "Graph node owner", 200);
  const id = clean(input.id, "Graph node ID", 300);
  const effectiveAt = validateTimestamp(input.effectiveAt, "Graph node effective timestamp");
  const expiresAt = validateTimestamp(input.expiresAt, "Graph node expiration timestamp");
  if (effectiveAt && expiresAt && new Date(expiresAt) <= new Date(effectiveAt)) {
    throw new Error("Graph node expiration must be after its effective timestamp");
  }
  return {
    ...input,
    id,
    ownerId,
    label: clean(input.label, "Graph node label", 500),
    confidence: validateConfidence(input.confidence),
    provenance: normalizeProvenance(input.provenance),
    effectiveAt,
    expiresAt,
  };
}

export function createKnowledgeGraphEdge(
  input: KnowledgeGraphEdge,
  nodes: ReadonlyMap<string, KnowledgeGraphNode>,
): KnowledgeGraphEdge {
  const ownerId = clean(input.ownerId, "Graph edge owner", 200);
  const fromNodeId = clean(input.fromNodeId, "Graph edge source node", 300);
  const toNodeId = clean(input.toNodeId, "Graph edge target node", 300);
  if (fromNodeId === toNodeId && input.type !== "related_to") {
    throw new Error("Knowledge graph self-edges are allowed only for related_to");
  }
  const from = nodes.get(fromNodeId);
  const to = nodes.get(toNodeId);
  if (!from || !to) throw new Error("Knowledge graph edges require existing endpoint nodes");
  if (from.ownerId !== ownerId || to.ownerId !== ownerId) {
    throw new Error("Knowledge graph edges cannot cross tenant boundaries");
  }
  const effectiveAt = validateTimestamp(input.effectiveAt, "Graph edge effective timestamp");
  const expiresAt = validateTimestamp(input.expiresAt, "Graph edge expiration timestamp");
  if (effectiveAt && expiresAt && new Date(expiresAt) <= new Date(effectiveAt)) {
    throw new Error("Graph edge expiration must be after its effective timestamp");
  }
  return {
    ...input,
    id: clean(input.id, "Graph edge ID", 300),
    ownerId,
    fromNodeId,
    toNodeId,
    confidence: validateConfidence(input.confidence),
    provenance: normalizeProvenance(input.provenance),
    effectiveAt,
    expiresAt,
  };
}

export function validateKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
  const normalizedNodes = nodes.map(createKnowledgeGraphNode);
  const nodeMap = new Map<string, KnowledgeGraphNode>();
  for (const node of normalizedNodes) {
    if (nodeMap.has(node.id)) throw new Error(`Duplicate knowledge graph node: ${node.id}`);
    nodeMap.set(node.id, node);
  }
  const normalizedEdges = edges.map((edge) => createKnowledgeGraphEdge(edge, nodeMap));
  const edgeIds = new Set<string>();
  for (const edge of normalizedEdges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate knowledge graph edge: ${edge.id}`);
    edgeIds.add(edge.id);
  }
  return { nodes: normalizedNodes, edges: normalizedEdges };
}
