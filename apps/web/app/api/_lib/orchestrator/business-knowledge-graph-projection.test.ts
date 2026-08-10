import { describe, expect, it } from "vitest";
import type { BusinessKnowledgeRecord } from "./business-knowledge";
import { projectApprovedBusinessKnowledge, projectApprovedMissionOutcome } from "./business-knowledge-graph-projection";
import { createMissionOutcome, approveMissionOutcomeForLearning } from "./mission-memory";

const approvedKnowledge: BusinessKnowledgeRecord = {
  id: "knowledge-1",
  ownerId: "owner-1",
  kind: "rule",
  stage: "approved",
  subject: "Refund approval",
  statement: "Refunds over $500 require owner approval.",
  confidence: 0.95,
  sources: [{
    sourceId: "policy.pdf",
    sourceType: "business_document",
    title: "Refund policy",
    verifiedAt: "2026-08-09T12:00:00Z",
  }],
  usageScopes: ["finance", "support"],
  effectiveAt: "2026-08-01T00:00:00Z",
  expiresAt: null,
  approvedBy: "owner-1",
  approvedAt: "2026-08-09T13:00:00Z",
  supersedesId: null,
  supersededById: null,
};

describe("Business Knowledge Graph projections", () => {
  it("projects approved Business Brain knowledge without losing its semantic kind", () => {
    const node = projectApprovedBusinessKnowledge(approvedKnowledge);
    expect(node).toMatchObject({
      id: "knowledge:knowledge-1",
      ownerId: "owner-1",
      type: "rule",
      label: "Refund approval",
      confidence: 0.95,
    });
    expect(node.properties.statement).toBe("Refunds over $500 require owner approval.");
  });

  it("rejects observed, learned-but-unapproved, and superseded knowledge", () => {
    expect(() => projectApprovedBusinessKnowledge({ ...approvedKnowledge, stage: "observed", approvedBy: null, approvedAt: null })).toThrow(/Only explicitly approved/);
    expect(() => projectApprovedBusinessKnowledge({ ...approvedKnowledge, stage: "learned", approvedBy: null, approvedAt: null })).toThrow(/Only explicitly approved/);
    expect(() => projectApprovedBusinessKnowledge({ ...approvedKnowledge, supersededById: "knowledge-2" })).toThrow(/Superseded/);
  });

  it("projects only conclusive owner-approved Mission Memory into mission and outcome nodes", () => {
    const record = createMissionOutcome({
      ownerId: "owner-1",
      missionId: "mission-1",
      hypothesis: "Shorter onboarding improves completion.",
      expectedOutcome: "Completion reaches 70%.",
      actualOutcome: "Completion reached 76%.",
      status: "success",
      metrics: [{ name: "Completion", expected: 70, actual: 76, unit: "%" }],
      evidence: ["analytics:experiment-1"],
      lesson: "Shorter onboarding improved completion for this cohort.",
      confidenceBefore: 0.5,
      confidenceAfter: 0.8,
      observedAt: "2026-08-09T12:00:00Z",
    });
    const approved = approveMissionOutcomeForLearning(record, "owner-1", "2026-08-09T13:00:00Z");
    const projected = projectApprovedMissionOutcome(approved);
    expect(projected.nodes.map((item) => item.type)).toEqual(["mission", "outcome"]);
    expect(projected.edges[0]).toMatchObject({ type: "produced", fromNodeId: "mission:mission-1", toNodeId: `outcome:${record.id}` });
  });

  it("refuses automatic completion observations and all unapproved outcomes", () => {
    const inconclusive = createMissionOutcome({
      ownerId: "owner-1",
      missionId: "mission-1",
      hypothesis: "Execution completion may advance the requested outcome.",
      expectedOutcome: "Business result improves.",
      actualOutcome: "Workflow completed but business impact has not been measured.",
      status: "inconclusive",
      metrics: [],
      evidence: ["workflow:workflow-1"],
      lesson: "Measure business impact before learning.",
      confidenceBefore: 0.5,
      confidenceAfter: 0.5,
      observedAt: "2026-08-09T12:00:00Z",
    });
    expect(() => projectApprovedMissionOutcome(inconclusive)).toThrow(/Only explicitly approved/);
  });
});
