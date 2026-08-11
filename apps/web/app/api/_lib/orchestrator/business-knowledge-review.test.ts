import { describe, expect, it } from "vitest";
import { reviewObservedKnowledge, type BusinessKnowledgeRecord } from "./business-knowledge";

const observed: BusinessKnowledgeRecord = {
  id: "knowledge-1", ownerId: "owner-1", kind: "policy", stage: "observed",
  subject: "Refunds", statement: "Refund requests require manager review.", confidence: 0.88,
  sources: [{ sourceId: "doc-1", sourceType: "business_document", title: "Operations manual", verifiedAt: "2026-08-11T12:00:00Z" }],
  usageScopes: ["operations"], reviewStatus: "pending",
};

describe("owner Business Brain review", () => {
  it("approves an observation as a new immutable trusted record", () => {
    const result = reviewObservedKnowledge(observed, "approve", "owner-1", undefined, new Date("2026-08-11T13:00:00Z"));
    expect(result.prior).toMatchObject({ id: "knowledge-1", reviewStatus: "approved" });
    expect(result.approved).toMatchObject({ id: "pending", stage: "approved", supersedesId: "knowledge-1", approvedBy: "owner-1" });
  });

  it("rejects without creating trusted knowledge", () => {
    const result = reviewObservedKnowledge(observed, "reject", "owner-1");
    expect(result.prior.reviewStatus).toBe("rejected");
    expect(result.approved).toBeUndefined();
  });

  it("lets the owner correct an observation before approval", () => {
    const result = reviewObservedKnowledge(observed, "supersede", "owner-1", { subject: "Refund approval", statement: "Refunds over $500 require manager review." });
    expect(result.prior.reviewStatus).toBe("superseded");
    expect(result.approved).toMatchObject({ subject: "Refund approval", statement: "Refunds over $500 require manager review.", stage: "approved" });
  });

  it("cannot review an already reviewed record twice", () => {
    expect(() => reviewObservedKnowledge({ ...observed, reviewStatus: "rejected" }, "approve", "owner-1")).toThrow(/Only pending/);
  });
});
