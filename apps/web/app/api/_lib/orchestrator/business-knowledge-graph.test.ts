import { describe, expect, it } from "vitest";
import {
  createKnowledgeGraphEdge,
  createKnowledgeGraphNode,
  validateKnowledgeGraph,
  type KnowledgeGraphNode,
} from "./business-knowledge-graph";

function node(id: string, ownerId = "owner-1"): KnowledgeGraphNode {
  return {
    id,
    ownerId,
    type: "policy",
    label: `Node ${id}`,
    properties: {},
    provenance: [{ sourceType: "business_knowledge", sourceId: `knowledge-${id}`, observedAt: "2026-08-09T12:00:00Z" }],
    confidence: 0.9,
    effectiveAt: null,
    expiresAt: null,
  };
}

describe("Business Knowledge Graph", () => {
  it("normalizes node timestamps, labels, and provenance", () => {
    const created = createKnowledgeGraphNode({
      ...node("policy-1"),
      label: "  Refund   approval  ",
      effectiveAt: "2026-08-01T00:00:00Z",
    });
    expect(created.label).toBe("Refund approval");
    expect(created.effectiveAt).toBe("2026-08-01T00:00:00.000Z");
    expect(created.provenance[0]?.observedAt).toBe("2026-08-09T12:00:00.000Z");
  });

  it("rejects cross-tenant edges even when both endpoint IDs exist", () => {
    const left = createKnowledgeGraphNode(node("left", "owner-1"));
    const right = createKnowledgeGraphNode(node("right", "owner-2"));
    const nodes = new Map([[left.id, left], [right.id, right]]);
    expect(() => createKnowledgeGraphEdge({
      id: "edge-1",
      ownerId: "owner-1",
      type: "related_to",
      fromNodeId: left.id,
      toNodeId: right.id,
      properties: {},
      provenance: [{ sourceType: "system", sourceId: "test", observedAt: "2026-08-09T12:00:00Z" }],
      confidence: 1,
      effectiveAt: null,
      expiresAt: null,
    }, nodes)).toThrow(/cross tenant boundaries/);
  });

  it("requires existing endpoint nodes and provenance", () => {
    const left = createKnowledgeGraphNode(node("left"));
    expect(() => createKnowledgeGraphEdge({
      id: "edge-1",
      ownerId: "owner-1",
      type: "supports",
      fromNodeId: left.id,
      toNodeId: "missing",
      properties: {},
      provenance: [{ sourceType: "research", sourceId: "research-1", observedAt: "2026-08-09T12:00:00Z" }],
      confidence: 0.8,
      effectiveAt: null,
      expiresAt: null,
    }, new Map([[left.id, left]]))).toThrow(/existing endpoint nodes/);

    expect(() => createKnowledgeGraphNode({ ...node("no-source"), provenance: [] })).toThrow(/require provenance/);
  });

  it("rejects duplicate node and edge identities", () => {
    expect(() => validateKnowledgeGraph([node("same"), node("same")], [])).toThrow(/Duplicate knowledge graph node/);
    const a = node("a");
    const b = node("b");
    const provenance = [{ sourceType: "system" as const, sourceId: "test", observedAt: "2026-08-09T12:00:00Z" }];
    expect(() => validateKnowledgeGraph([a, b], [
      { id: "edge", ownerId: "owner-1", type: "supports", fromNodeId: "a", toNodeId: "b", properties: {}, provenance, confidence: 1, effectiveAt: null, expiresAt: null },
      { id: "edge", ownerId: "owner-1", type: "related_to", fromNodeId: "a", toNodeId: "b", properties: {}, provenance, confidence: 1, effectiveAt: null, expiresAt: null },
    ])).toThrow(/Duplicate knowledge graph edge/);
  });

  it("rejects invalid confidence, chronology, and non-related self edges", () => {
    expect(() => createKnowledgeGraphNode({ ...node("bad-confidence"), confidence: 1.1 })).toThrow(/between 0 and 1/);
    expect(() => createKnowledgeGraphNode({
      ...node("bad-time"),
      effectiveAt: "2026-08-10T00:00:00Z",
      expiresAt: "2026-08-09T00:00:00Z",
    })).toThrow(/expiration must be after/);

    const same = createKnowledgeGraphNode(node("same"));
    expect(() => createKnowledgeGraphEdge({
      id: "self",
      ownerId: "owner-1",
      type: "supports",
      fromNodeId: "same",
      toNodeId: "same",
      properties: {},
      provenance: [{ sourceType: "system", sourceId: "test", observedAt: "2026-08-09T12:00:00Z" }],
      confidence: 1,
      effectiveAt: null,
      expiresAt: null,
    }, new Map([[same.id, same]]))).toThrow(/self-edges/);
  });
});
