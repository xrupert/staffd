import type { KnowledgeGraphNode } from "./business-knowledge-graph";

export type MissionPlanningContextItem = {
  nodeId: string;
  type: KnowledgeGraphNode["type"];
  label: string;
  confidence: number;
  provenance: string[];
};

export type MissionPlanningContext = {
  source: "business_knowledge_graph";
  generatedAt: string;
  degraded: boolean;
  items: MissionPlanningContextItem[];
  constraints: string[];
  priorOutcomes: string[];
  warnings: string[];
};

const HIGH_VALUE_TYPES = new Set<KnowledgeGraphNode["type"]>([
  "policy",
  "rule",
  "risk",
  "process",
  "decision",
  "outcome",
  "experiment",
  "preference",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4),
  );
}

function searchableText(node: KnowledgeGraphNode): string {
  return `${node.label} ${Object.values(node.properties).filter((value) => value != null).join(" ")}`.toLowerCase();
}

function active(node: KnowledgeGraphNode, now: Date): boolean {
  if (!node.expiresAt) return true;
  return new Date(node.expiresAt).getTime() > now.getTime();
}

function relevance(goalTokens: Set<string>, node: KnowledgeGraphNode): number {
  const text = searchableText(node);
  let score = HIGH_VALUE_TYPES.has(node.type) ? 2 : 0;
  for (const token of goalTokens) if (text.includes(token)) score += 1;
  score += node.confidence;
  return score;
}

function provenanceRefs(node: KnowledgeGraphNode): string[] {
  return node.provenance.map((item) => `${item.sourceType}:${item.sourceId}`);
}

export function buildMissionPlanningContext(
  goal: string,
  nodes: KnowledgeGraphNode[],
  now = new Date(),
  degraded = false,
): MissionPlanningContext {
  if (!Number.isFinite(now.getTime())) throw new Error("Mission planning context time is invalid");
  const goalTokens = tokens(goal);
  const ranked = nodes
    .filter((node) => active(node, now))
    .map((node) => ({ node, score: relevance(goalTokens, node) }))
    .filter(({ score, node }) => score >= (HIGH_VALUE_TYPES.has(node.type) ? 2.5 : 1.5))
    .sort((left, right) => right.score - left.score || right.node.confidence - left.node.confidence)
    .slice(0, 12)
    .map(({ node }) => ({
      nodeId: node.id,
      type: node.type,
      label: node.label,
      confidence: node.confidence,
      provenance: provenanceRefs(node),
    }));

  const constraints = ranked
    .filter((item) => ["policy", "rule", "risk", "process", "preference"].includes(item.type))
    .map((item) => `${item.type}: ${item.label}`);
  const priorOutcomes = ranked
    .filter((item) => item.type === "outcome" || item.type === "experiment")
    .map((item) => item.label);
  const warnings = ranked
    .filter((item) => item.type === "risk")
    .map((item) => item.label);

  return {
    source: "business_knowledge_graph",
    generatedAt: now.toISOString(),
    degraded,
    items: ranked,
    constraints: [...new Set(constraints)],
    priorOutcomes: [...new Set(priorOutcomes)],
    warnings: [...new Set(warnings)],
  };
}
