import { describe, expect, it } from "vitest";
import type { BusinessKnowledgeRecord } from "../_lib/orchestrator/business-knowledge";
import { promoteKnowledge } from "../_lib/orchestrator/business-knowledge";

const observed: BusinessKnowledgeRecord = {
  id: "record-1",
  ownerId: "owner-1",
  kind: "process",
  stage: "observed",
  subject: "Lead follow-up",
  statement: "Warm leads receive a follow-up within two business days.",
  confidence: 0.7,
  sources: [{
    sourceId: "sop-1",
    sourceType: "business_document",
    title: "Sales SOP",
    verifiedAt: "2026-08-06T12:00:00.000Z",
  }],
  usageScopes: ["sales"],
};

describe("Business Brain API transition contract", () => {
  it("keeps owner identity when promoting knowledge", () => {
    const promoted = promoteKnowledge(observed, {
      independentSourceCount: 1,
      repeatedObservationCount: 1,
      hasContradiction: false,
      ownerApproved: false,
    }, "owner-1");
    expect(promoted.ownerId).toBe("owner-1");
    expect(promoted.stage).toBe("inferred");
  });

  it("blocks contradictory evidence before persistence", () => {
    expect(() => promoteKnowledge(observed, {
      independentSourceCount: 2,
      repeatedObservationCount: 4,
      hasContradiction: true,
      ownerApproved: false,
    }, "owner-1")).toThrow("Contradicted");
  });
});
