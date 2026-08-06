import { describe, expect, it } from "vitest";
import {
  promoteKnowledge,
  supersedeKnowledge,
  validateBusinessKnowledge,
  type BusinessKnowledgeRecord,
} from "./business-knowledge";

const base: BusinessKnowledgeRecord = {
  id: "k1",
  ownerId: "owner-1",
  kind: "process",
  stage: "observed",
  subject: "Newsletter scheduling",
  statement: "Tuesday morning sends produced the strongest open rate.",
  confidence: 0.62,
  sources: [{
    sourceId: "campaign-1",
    sourceType: "connected_system",
    title: "Listmonk campaign result",
    verifiedAt: "2026-08-06T12:00:00.000Z",
  }],
  usageScopes: ["marketing"],
};

describe("Business Brain knowledge governance", () => {
  it("requires provenance and a usage scope", () => {
    expect(() => validateBusinessKnowledge({ ...base, sources: [] })).toThrow("provenance");
    expect(() => validateBusinessKnowledge({ ...base, usageScopes: [] })).toThrow("usage scope");
  });

  it("promotes only through observed, inferred, learned, approved", () => {
    const inferred = promoteKnowledge(base, {
      independentSourceCount: 1,
      repeatedObservationCount: 1,
      hasContradiction: false,
      ownerApproved: false,
    });
    expect(inferred.stage).toBe("inferred");

    const learned = promoteKnowledge(inferred, {
      independentSourceCount: 2,
      repeatedObservationCount: 3,
      hasContradiction: false,
      ownerApproved: false,
    });
    expect(learned.stage).toBe("learned");

    const approved = promoteKnowledge(learned, {
      independentSourceCount: 2,
      repeatedObservationCount: 3,
      hasContradiction: false,
      ownerApproved: true,
    }, "owner-1", new Date("2026-08-06T13:00:00.000Z"));
    expect(approved.stage).toBe("approved");
    expect(approved.approvedBy).toBe("owner-1");
  });

  it("blocks promotion when evidence conflicts", () => {
    expect(() => promoteKnowledge(base, {
      independentSourceCount: 2,
      repeatedObservationCount: 4,
      hasContradiction: true,
      ownerApproved: false,
    })).toThrow("Contradicted");
  });

  it("requires explicit owner approval for durable knowledge", () => {
    const learned = { ...base, stage: "learned" as const };
    expect(() => promoteKnowledge(learned, {
      independentSourceCount: 2,
      repeatedObservationCount: 4,
      hasContradiction: false,
      ownerApproved: false,
    })).toThrow("owner approval");
  });

  it("supersedes immutably within one owner boundary", () => {
    const prior: BusinessKnowledgeRecord = {
      ...base,
      stage: "approved",
      approvedBy: "owner-1",
      approvedAt: "2026-07-01T00:00:00.000Z",
    };
    const replacement: BusinessKnowledgeRecord = {
      ...prior,
      id: "k2",
      statement: "Holiday weeks require a different send schedule.",
    };
    const result = supersedeKnowledge(prior, replacement);
    expect(result.prior.supersededById).toBe("k2");
    expect(result.replacement.supersedesId).toBe("k1");
  });
});
