import { describe, expect, it } from "vitest";
import { approvedResearchToKnowledge } from "./research-to-knowledge";
import type { ResearchRecord } from "./research-records";

const approved: ResearchRecord & { id: string } = {
  id: "research-1",
  user: "owner-1",
  bundle_id: "bundle-1",
  topic: "Accounting procedure",
  claim: "The procedure remains compliant.",
  label: "fact",
  risk: "high",
  verified_at: "2026-08-06T12:00:00.000Z",
  reverify_after: "2026-09-05T12:00:00.000Z",
  verdict: { answerable: true, confidence: "high", reason: "Independent authorities agree.", requiresHumanReview: true },
  citations: [],
  answer: { text: "The procedure remains compliant.", requiresHumanReview: true },
  review_status: "approved",
  reviewed_at: "2026-08-06T13:00:00.000Z",
  reviewed_by: "owner-1",
};

describe("approvedResearchToKnowledge", () => {
  it("preserves owner approval and research provenance", () => {
    const record = approvedResearchToKnowledge({ research: approved, kind: "policy", usageScopes: ["finance"] });
    expect(record.stage).toBe("approved");
    expect(record.ownerId).toBe("owner-1");
    expect(record.sources[0]?.sourceId).toBe("research-1");
    expect(record.approvedBy).toBe("owner-1");
  });

  it("rejects research that was not explicitly approved", () => {
    expect(() => approvedResearchToKnowledge({
      research: { ...approved, review_status: "pending", reviewed_at: null, reviewed_by: null },
      kind: "fact",
      usageScopes: ["operations"],
    })).toThrow("owner-approved");
  });
});
