import { describe, expect, it } from "vitest";
import {
  evaluateGovernedResearchRun,
  governedResearchAnswerCases,
  governedResearchAnswerSuite,
  validateGovernedResearchBenchmark,
} from "./research-answer-benchmark";
import type { EvalCaseResult } from "./eval-engineering";

function passingResults(): EvalCaseResult[] {
  return governedResearchAnswerCases.map((testCase) => ({
    caseId: testCase.id,
    scores: Object.fromEntries(Object.keys(testCase.rubric).map((dimension) => [dimension, 1])),
    costUsd: Math.min(governedResearchAnswerSuite.maximumCostUsd ?? 0.08, 0.02),
    latencyMs: Math.min(governedResearchAnswerSuite.maximumLatencyMs ?? 8_000, 1_500),
    passedAssertions: true,
    evidence: [`evidence:${testCase.id}`],
  }));
}

describe("governed research answer benchmark", () => {
  it("contains every required risk and quality category", () => {
    expect(() => validateGovernedResearchBenchmark()).not.toThrow();
    expect(governedResearchAnswerCases).toHaveLength(10);
    expect(governedResearchAnswerCases.filter((testCase) => testCase.kind === "adversarial").length).toBeGreaterThanOrEqual(4);
    expect(governedResearchAnswerCases.some((testCase) => testCase.tags.includes("tenant_isolation"))).toBe(true);
    expect(governedResearchAnswerCases.some((testCase) => testCase.tags.includes("source_disagreement"))).toBe(true);
  });

  it("releases a perfect run that satisfies all cases, thresholds, and budgets", () => {
    const verdict = evaluateGovernedResearchRun(passingResults());
    expect(verdict.releasable).toBe(true);
    expect(verdict.passRate).toBe(1);
    expect(verdict.dimensionScores.safety).toBe(1);
    expect(verdict.dimensionScores.tenant_isolation).toBe(1);
  });

  it("blocks an unsupported claim regression", () => {
    const results = passingResults();
    const index = results.findIndex((result) => result.caseId === "research-unsupported-claim");
    results[index] = {
      ...results[index]!,
      scores: { ...results[index]!.scores, groundedness: 0.4, safety: 0.5 },
      passedAssertions: false,
    };
    const verdict = evaluateGovernedResearchRun(results);
    expect(verdict.releasable).toBe(false);
    expect(verdict.failures).toEqual(expect.arrayContaining([
      "research-unsupported-claim failed deterministic assertions",
      "groundedness score is below the release threshold",
      "safety score is below the release threshold",
    ]));
  });

  it("blocks prompt-injection and tenant-isolation regressions", () => {
    const results = passingResults();
    for (const caseId of ["research-prompt-injection-source", "research-tenant-isolation"]) {
      const index = results.findIndex((result) => result.caseId === caseId);
      results[index] = {
        ...results[index]!,
        scores: { ...results[index]!.scores, safety: 0, tenant_isolation: 0 },
        passedAssertions: false,
      };
    }
    const verdict = evaluateGovernedResearchRun(results);
    expect(verdict.releasable).toBe(false);
    expect(verdict.dimensionScores.tenant_isolation).toBeLessThan(1);
    expect(verdict.failures).toEqual(expect.arrayContaining([
      "research-prompt-injection-source failed deterministic assertions",
      "research-tenant-isolation failed deterministic assertions",
      "tenant_isolation score is below the release threshold",
    ]));
  });

  it("blocks a high-risk answer that bypasses approval even when prose quality is high", () => {
    const results = passingResults();
    const index = results.findIndex((result) => result.caseId === "research-high-risk-approval");
    results[index] = { ...results[index]!, passedAssertions: false };
    const verdict = evaluateGovernedResearchRun(results);
    expect(verdict.releasable).toBe(false);
    expect(verdict.failures).toContain("research-high-risk-approval failed deterministic assertions");
  });

  it("blocks routine answers that exceed cost or latency budgets", () => {
    const results = passingResults();
    const costIndex = results.findIndex((result) => result.caseId === "research-cost-budget");
    const latencyIndex = results.findIndex((result) => result.caseId === "research-latency-budget");
    results[costIndex] = { ...results[costIndex]!, costUsd: (governedResearchAnswerSuite.maximumCostUsd ?? 0.08) + 0.01 };
    results[latencyIndex] = { ...results[latencyIndex]!, latencyMs: (governedResearchAnswerSuite.maximumLatencyMs ?? 8_000) + 1 };
    const verdict = evaluateGovernedResearchRun(results);
    expect(verdict.releasable).toBe(false);
    expect(verdict.failures).toEqual(expect.arrayContaining([
      "research-cost-budget exceeded cost budget",
      "research-latency-budget exceeded latency budget",
    ]));
  });
});
