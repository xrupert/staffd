import { describe, expect, it } from "vitest";
import { evaluateResearchClaim, researchRiskForTopic, type ResearchSource } from "./research-evidence";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function source(overrides: Partial<ResearchSource>): ResearchSource {
  return {
    id: "source-1",
    title: "Authoritative guidance",
    url: "https://authority.example/guidance",
    sourceClass: "government_or_regulator",
    publishedAt: "2026-07-01T00:00:00.000Z",
    retrievedAt: "2026-08-05T10:00:00.000Z",
    supports: "supports",
    ...overrides,
  };
}

describe("verified research evidence", () => {
  it("requires independent authoritative corroboration for high-risk claims", () => {
    const verdict = evaluateResearchClaim({
      statement: "The accounting treatment is permitted.",
      label: "fact",
      timeSensitive: true,
      sources: [
        source({ id: "a", url: "https://irs.gov/a" }),
        source({ id: "b", url: "https://fasb.org/b", sourceClass: "primary_documentation" }),
      ],
    }, "high", NOW);

    expect(verdict.answerable).toBe(true);
    expect(verdict.confidence).toBe("high");
    expect(verdict.requiresHumanReview).toBe(true);
  });

  it("rejects high-risk claims backed by one authority repeated twice", () => {
    const verdict = evaluateResearchClaim({
      statement: "The tax rule applies.",
      label: "fact",
      timeSensitive: true,
      sources: [
        source({ id: "a", url: "https://irs.gov/a" }),
        source({ id: "b", url: "https://irs.gov/b" }),
      ],
    }, "high", NOW);

    expect(verdict.answerable).toBe(false);
    expect(verdict.reason).toContain("independent authoritative sources");
  });

  it("fails closed when credible sources disagree", () => {
    const verdict = evaluateResearchClaim({
      statement: "The procedure is required.",
      label: "fact",
      timeSensitive: false,
      sources: [
        source({ id: "a", supports: "supports" }),
        source({ id: "b", url: "https://second.example/opinion", supports: "contradicts" }),
      ],
    }, "standard", NOW);

    expect(verdict.answerable).toBe(false);
    expect(verdict.agreement).toBe("mixed");
    expect(verdict.requiresHumanReview).toBe(true);
  });

  it("does not silently convert assumptions or unknowns into facts", () => {
    const evidence = [source({})];
    expect(evaluateResearchClaim({
      statement: "A likely but unverified explanation.",
      label: "assumption",
      timeSensitive: false,
      sources: evidence,
    }, "standard", NOW).answerable).toBe(false);
    expect(evaluateResearchClaim({
      statement: "The answer is not known.",
      label: "unknown",
      timeSensitive: false,
      sources: [],
    }, "standard", NOW).answerable).toBe(false);
  });

  it("requires current evidence for high-risk time-sensitive claims", () => {
    const verdict = evaluateResearchClaim({
      statement: "The current regulation allows this action.",
      label: "fact",
      timeSensitive: true,
      sources: [
        source({ id: "a", url: "https://agency.gov/a", publishedAt: "2020-01-01T00:00:00.000Z" }),
        source({ id: "b", url: "https://standards.org/b", publishedAt: "2020-01-01T00:00:00.000Z" }),
      ],
    }, "high", NOW);

    expect(verdict.answerable).toBe(false);
    expect(verdict.reason).toContain("current authoritative sources");
  });

  it("automatically raises evidence requirements for sensitive domains", () => {
    expect(researchRiskForTopic("How should I post this QuickBooks accounting transaction?")).toBe("high");
    expect(researchRiskForTopic("Write a social caption for a bakery")).toBe("standard");
  });
});
