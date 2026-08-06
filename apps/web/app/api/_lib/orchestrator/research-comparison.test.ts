import { describe, expect, it } from "vitest";
import { compareRefreshedEvidence, type RefreshComparisonInput } from "./research-comparison";

const source = {
  id: "s1",
  title: "Official guidance",
  url: "https://www.irs.gov/example",
  sourceClass: "government_or_regulator" as const,
  retrievedAt: "2026-08-06T10:00:00.000Z",
  publishedAt: "2026-08-01T00:00:00.000Z",
};

const base: RefreshComparisonInput = {
  topic: "Accounting compliance",
  claim: "The procedure remains compliant.",
  label: "fact",
  timeSensitive: true,
  sources: [
    { ...source, relationship: "supports" },
    { ...source, id: "s2", url: "https://www.irs.gov/example-2", relationship: "supports" },
  ],
};

describe("compareRefreshedEvidence", () => {
  it("confirms conclusions that still satisfy the evidence threshold", () => {
    const result = compareRefreshedEvidence(base, new Date("2026-08-06T12:00:00.000Z"));
    expect(result.outcome).toBe("confirmed");
    expect(result.bundle?.verdict.answerable).toBe(true);
    expect(result.blocksDependentActions).toBe(false);
  });

  it("blocks dependent actions when current evidence contradicts the conclusion", () => {
    const result = compareRefreshedEvidence({
      ...base,
      sources: [{ ...source, relationship: "contradicts" }],
    }, new Date("2026-08-06T12:00:00.000Z"));
    expect(result.outcome).toBe("contradicted");
    expect(result.blocksDependentActions).toBe(true);
    expect(result.requiresOwnerReview).toBe(true);
  });

  it("refuses to compare unclassified evidence", () => {
    const result = compareRefreshedEvidence({
      ...base,
      sources: [{ ...source, relationship: "context_only" }],
    });
    expect(result.outcome).toBe("unclassified");
    expect(result.bundle).toBeNull();
  });
});
