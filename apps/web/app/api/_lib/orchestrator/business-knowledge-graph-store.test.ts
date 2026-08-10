import { describe, expect, it } from "vitest";
import {
  fromStoredKnowledgeGraphEdge,
  fromStoredKnowledgeGraphNode,
  toStoredKnowledgeGraphEdge,
  toStoredKnowledgeGraphNode,
} from "./business-knowledge-graph-store";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "./business-knowledge-graph";

const node: KnowledgeGraphNode = {
  id: "policy-1",
  ownerId: "owner-1",
  type: "policy",
  label: "Refund approval",
  properties: { threshold: 500 },
  provenance: [{ sourceType: "business_knowledge", sourceId: "knowledge-1", observedAt: "2026-08-09T12:00:00Z" }],
  confidence: 0.9,
  effectiveAt: "2026-08-01T00:00:00Z",
  expiresAt: null,
};

const edge: KnowledgeGraphEdge = {
  id: "edge-1",
  ownerId: "owner-1",
  type: "governed_by",
  fromNodeId: "mission-1",
  toNodeId: "policy-1",
  properties: {},
  provenance: [{ sourceType: "system", sourceId: "mission-plan-1", observedAt: "2026-08-09T12:30:00Z" }],
  confidence: 1,
  effectiveAt: null,
  expiresAt: null,
};

describe("Business Knowledge Graph storage", () => {
  it("round-trips nodes through canonical validation", () => {
    const stored = toStoredKnowledgeGraphNode(node);
    expect(stored).toMatchObject({ graph_id: "policy-1", user: "owner-1", node_type: "policy" });
    expect(fromStoredKnowledgeGraphNode(stored)).toEqual({
      ...node,
      effectiveAt: "2026-08-01T00:00:00.000Z",
      provenance: [{ ...node.provenance[0], observedAt: "2026-08-09T12:00:00.000Z" }],
    });
  });

  it("round-trips edges only when both owner-scoped endpoints exist", () => {
    const missionNode: KnowledgeGraphNode = { ...node, id: "mission-1", type: "mission", label: "Launch campaign" };
    const normalizedPolicy = fromStoredKnowledgeGraphNode(toStoredKnowledgeGraphNode(node));
    const normalizedMission = fromStoredKnowledgeGraphNode(toStoredKnowledgeGraphNode(missionNode));
    const nodes = new Map([[normalizedPolicy.id, normalizedPolicy], [normalizedMission.id, normalizedMission]]);
    const stored = toStoredKnowledgeGraphEdge(edge, nodes);
    expect(fromStoredKnowledgeGraphEdge(stored, nodes)).toEqual({
      ...edge,
      provenance: [{ ...edge.provenance[0], observedAt: "2026-08-09T12:30:00.000Z" }],
    });
  });

  it("refuses persisted cross-tenant edges during hydration", () => {
    const missionNode = fromStoredKnowledgeGraphNode(toStoredKnowledgeGraphNode({ ...node, id: "mission-1", type: "mission", label: "Mission" }));
    const otherPolicy = fromStoredKnowledgeGraphNode(toStoredKnowledgeGraphNode({ ...node, ownerId: "owner-2" }));
    const nodes = new Map([[missionNode.id, missionNode], [otherPolicy.id, otherPolicy]]);
    expect(() => fromStoredKnowledgeGraphEdge({
      graph_id: "bad-edge",
      user: "owner-1",
      edge_type: "related_to",
      from_node_id: "mission-1",
      to_node_id: "policy-1",
      properties: {},
      provenance: [{ sourceType: "system", sourceId: "test", observedAt: "2026-08-09T12:00:00Z" }],
      confidence: 1,
      effective_at: null,
      expires_at: null,
    }, nodes)).toThrow(/cross tenant boundaries/);
  });
});
