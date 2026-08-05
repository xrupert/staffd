import { describe, expect, it } from "vitest";
import { verifyResearchClaim } from "./research-verification";

const NOW = new Date("2026-08-05T16:00:00.000Z");

function source(
  id: string,
  url: string,
  supports: "supports" | "contradicts" | "context_only" = "supports",
) {
  return {
    id,
    title: `Source ${id}`,
    url,
    sourceClass: "government_or_regulator" as const,
    retrievedAt: "2026-08-05T15:00:00.000Z",
    publishedAt: "2026-07-15T00:00:00.000Z",
    supports,
    excerpt: "Relevant evidence.",
  };
}

describe("research verification", () => {
  it("supports a standard factual claim with authoritative evidence", () => {
    const bundle = verifyResearchClaim({
      topic: "Current small business filing guidance",
      claim: "The filing is required by the stated deadline.",
      label: "fact",
      timeSensitive: true,
      sources: [source("one", "https://agency.gov/guidance")],
    }, NOW);

    expect(bundle.answer.supported).toBe(true);
    expect(bundle.answer.statement).toContain("filing is required");
    expect(bundle.citations).toHaveLength(1);
    expect(bundle.id).toMatch(/^research-/);
  });

  it("requires two independent authorities for high-risk accounting guidance", () => {
    const bundle = verifyResearchClaim({
      topic: "How should this accounting transaction be posted?",
      claim: "The transaction belongs in the stated account.",
      label: "fact",
      timeSensitive: true,
      sources: [source("one", "https://agency.gov/accounting")],
    }, NOW);

    expect(bundle.risk).toBe("high");
    expect(bundle.answer.supported).toBe(false);
    expect(bundle.answer.statement).toBeNull();
    expect(bundle.answer.requiresHumanReview).toBe(true);
  });

  it("blocks unresolved disagreement", () => {
    const bundle = verifyResearchClaim({
      topic: "Current compliance requirement",
      claim: "The requirement applies.",
      label: "fact",
      sources: [
        source("one", "https://agency.gov/rule", "supports"),
        source("two", "https://regulator.gov/notice", "contradicts"),
      ],
    }, NOW);

    expect(bundle.answer.supported).toBe(false);
    expect(bundle.verdict.agreement).toBe("mixed");
    expect(bundle.answer.reason).toContain("disagreement");
  });

  it("never promotes an assumption into an answer", () => {
    const bundle = verifyResearchClaim({
      topic: "Marketing performance",
      claim: "This message will increase conversion.",
      label: "assumption",
      sources: [source("one", "https://agency.gov/example")],
    }, NOW);

    expect(bundle.answer.supported).toBe(false);
    expect(bundle.answer.statement).toBeNull();
  });

  it("rejects duplicate source URLs", () => {
    expect(() => verifyResearchClaim({
      topic: "Research topic",
      claim: "A claim.",
      label: "fact",
      sources: [
        source("one", "https://agency.gov/same"),
        source("two", "https://agency.gov/same"),
      ],
    }, NOW)).toThrow("Duplicate research source URL");
  });
});
