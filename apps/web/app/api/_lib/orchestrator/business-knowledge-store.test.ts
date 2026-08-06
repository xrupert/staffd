import { describe, expect, it } from "vitest";
import type { BusinessKnowledgeRecord } from "./business-knowledge";
import { fromStoredBusinessKnowledge, toStoredBusinessKnowledge } from "./business-knowledge-store";

const record: BusinessKnowledgeRecord = {
  id: "k1",
  ownerId: "owner-1",
  kind: "policy",
  stage: "approved",
  subject: "Refund approval",
  statement: "Refunds above $500 require owner approval.",
  confidence: 1,
  sources: [{
    sourceId: "policy-1",
    sourceType: "business_document",
    title: "Refund policy",
    verifiedAt: "2026-08-06T12:00:00.000Z",
  }],
  usageScopes: ["finance", "support"],
  effectiveAt: "2026-08-01T00:00:00.000Z",
  approvedBy: "owner-1",
  approvedAt: "2026-08-06T12:30:00.000Z",
};

describe("Business Brain persistence mapping", () => {
  it("preserves governed knowledge through storage mapping", () => {
    const stored = { id: record.id, ...toStoredBusinessKnowledge(record) };
    expect(fromStoredBusinessKnowledge(stored)).toEqual({
      ...record,
      expiresAt: null,
      supersedesId: null,
      supersededById: null,
    });
  });

  it("never allows the caller to replace the owner during mapping", () => {
    const stored = toStoredBusinessKnowledge(record);
    expect(stored.user).toBe("owner-1");
  });
});
