import { describe, expect, it } from "vitest";
import { buildResearchRefreshRecord } from "./research-refresh";

const parent = {
  id: "r1",
  user: "u1",
  topic: "Accounting",
  claim: "The procedure remains compliant.",
  risk: "high" as const,
  review_status: "approved" as const,
  verified_at: "2026-06-01T00:00:00.000Z",
  reverify_after: "2026-07-01T00:00:00.000Z",
};

const search = {
  query: "Verify current accounting guidance",
  risk: "high" as const,
  provider: "firecrawl" as const,
  retrievedAt: "2026-08-05T12:00:00.000Z",
  candidates: [{
    id: "s1",
    title: "Official guidance",
    url: "https://www.irs.gov/example",
    sourceClass: "government_or_regulator" as const,
    retrievedAt: "2026-08-05T12:00:00.000Z",
    supports: "context_only" as const,
    description: "Current guidance",
    excerpt: "Current official guidance.",
  }],
};

describe("research refresh records", () => {
  it("preserves the approved claim while requiring classification of fresh evidence", () => {
    const record = buildResearchRefreshRecord(parent, search, "2026-09-04T12:00:00.000Z");
    expect(record).toMatchObject({
      user: "u1",
      claim: parent.claim,
      review_status: "pending",
      reverify_status: "awaiting_classification",
      parent_record: "r1",
    });
    expect(record.answer.statement).toBeNull();
    expect(record.citations.at(0)?.relationship).toBe("context_only");
  });

  it("fails closed when fresh search returns no evidence", () => {
    expect(() => buildResearchRefreshRecord(parent, { ...search, candidates: [] }, "2026-09-04T12:00:00.000Z"))
      .toThrow("no evidence");
  });
});
