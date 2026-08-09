import { describe, expect, it } from "vitest";
import type { BusinessKnowledgeRecord } from "./business-knowledge";
import { approveMissionOutcomeForLearning, createMissionOutcome } from "./mission-memory";
import { approvedKnowledgeToGraphNode, approvedMissionOutcomeToGraphNode } from "./knowledge-graph-projection";

function knowledge(overrides: Partial<BusinessKnowledgeRecord> = {}): BusinessKnowledgeRecord {
  return {
    id: "knowledge-1",
    ownerId: "owner-1",
    kind: "policy",
    stage: "approved",
    subject: "Refund approval",
    statement: "Refunds above $500 require owner approval.",
    confidence: 0.95,
    sources: [{
      sourceId: "doc-1",
      sourceType: "business_document",
      title: "Refund policy",
      verifiedAt: "2026-08-09T12:00:00Z",
    }],
    usageScopes: ["finance", "support"],
    effectiveAt: "2026-08-01T00:00:00Z",
    expiresAt: null,
    approvedBy: "owner-1",
    approvedAt: "2026-08-09T12:30:00Z",
    supersedesId: null,
    supersededById: null,
    ...overrides,
  };
}

describe("Knowledge Graph projections", () => {
  it("projects only active approved Business Brain knowledge", () => {
    const node = approvedKnowledgeToGraphNode(knowledge());
    expect(node).toMatchObject({
      id: "knowledge:knowledge-1",
      ownerId: "owner-1",
      type: "policy",
      label: "Refund approval",
      confidence: 0.95,
    });
    expect(node.properties.statement).toBe("Refunds above $500 require owner approval.");
    expect(node.provenance).toEqual([{ sourceType: "business_knowledge", sourceId: "knowledge-1", observedAt: "2026-08-09T12:30:00.000Z" }]);
  });

  it("rejects observed or superseded Business Brain knowledge", () => {
    expect(() => approvedKnowledgeToGraphNode(knowledge({ stage: "observed", approvedBy: null, approvedAt: null }))).toThrow(/Only explicitly approved/);
    expect(() => approvedKnowledgeToGraphNode(knowledge({ supersededById: "knowledge-2" }))).toThrow(/Superseded/);
  });

  it("projects only owner-approved, conclusive Mission Memory", () => {
    const observed = createMissionOutcome({
      ownerId: "owner-1",
      missionId: "mission-1",
      hypothesis: "Tuesday morning improves opens.",
      expectedOutcome: "Open rate exceeds 35%.",
      actualOutcome: "Open rate reached 39%.",
      status: "success",
      metrics: [{ name: "Open rate", expected: 35, actual: 39, unit: "%" }],
      evidence: ["listmonk:campaign-42"],
      lesson: "Tuesday morning outperformed the baseline for this audience.",
      confidenceBefore: 0.5,
      confidenceAfter: 0.75,
      observedAt: "2026-08-09T12:00:00Z",
    });
    const approved = approveMissionOutcomeForLearning(observed, "owner-1", "2026-08-09T13:00:00Z");
    const node = approvedMissionOutcomeToGraphNode(approved);
    expect(node).toMatchObject({
      id: `outcome:${approved.id}`,
      ownerId: "owner-1",
      type: "outcome",
      confidence: 0.75,
    });
    expect(node.properties.lesson).toContain("outperformed");
  });

  it("blocks unapproved and inconclusive Mission Memory from graph learning", () => {
    const unapproved = createMissionOutcome({
      ownerId: "owner-1",
      missionId: "mission-1",
      hypothesis: "Execution will improve the outcome.",
      expectedOutcome: "Outcome improves.",
      actualOutcome: "Execution completed but impact is not measured.",
      status: "inconclusive",
      metrics: [],
      evidence: ["mission:mission-1"],
      lesson: "Impact is not measured yet.",
      confidenceBefore: 0.5,
      confidenceAfter: 0.5,
      observedAt: "2026-08-09T12:00:00Z",
    });
    expect(() => approvedMissionOutcomeToGraphNode(unapproved)).toThrow(/owner-approved/);
    const forced = { ...unapproved, approvedForLearning: true, approvedBy: "owner-1", approvedAt: "2026-08-09T13:00:00Z" };
    expect(() => approvedMissionOutcomeToGraphNode(forced)).toThrow(/Inconclusive/);
  });
});
