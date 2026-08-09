import { describe, expect, it } from "vitest";
import type { ResearchVerificationBundle } from "../orchestrator/research-verification";
import { productionTraceToResearchObservation } from "./research-production-trace";

function bundle(overrides: Partial<ResearchVerificationBundle> = {}): ResearchVerificationBundle {
  return {
    id: "research-1",
    topic: "Current filing guidance",
    claim: "The filing is required.",
    label: "fact",
    risk: "standard",
    verifiedAt: "2026-08-09T12:00:00Z",
    verdict: {
      answerable: true,
      confidence: "high",
      reason: "Independent authoritative sources agree.",
      agreement: "corroborated",
      requiresHumanReview: false,
      sourceIds: ["one", "two"],
    },
    citations: [
      {
        id: "one",
        title: "Agency guidance",
        url: "https://agency.gov/guidance",
        sourceClass: "government_or_regulator",
        publishedAt: "2026-08-01T00:00:00Z",
        retrievedAt: "2026-08-09T12:00:00Z",
        relationship: "supports",
      },
      {
        id: "two",
        title: "Primary documentation",
        url: "https://docs.example.org/rule",
        sourceClass: "primary_documentation",
        publishedAt: "2026-08-02T00:00:00Z",
        retrievedAt: "2026-08-09T12:00:00Z",
        relationship: "supports",
      },
    ],
    answer: {
      supported: true,
      confidence: "high",
      statement: "The filing is required.",
      reason: "Independent authoritative sources agree.",
      requiresHumanReview: false,
    },
    ...overrides,
  };
}

function trace(verification = bundle()) {
  return {
    caseId: "research-authoritative-primary",
    verification,
    answerCorrect: true,
    completed: true,
    businessUseful: true,
    costUsd: 0.02,
    latencyMs: 1200,
    crossTenantAccessBlocked: true,
  };
}

describe("production research traces", () => {
  it("derives authority, citation, runtime, and evidence facts from a verified execution", () => {
    const observation = productionTraceToResearchObservation({ ...trace(), evidence: ["mission:123", "mission:123"] });
    expect(observation.citationsPresent).toBe(true);
    expect(observation.authoritativeSourceCount).toBe(2);
    expect(observation.independentAuthorityCount).toBe(2);
    expect(observation.costUsd).toBe(0.02);
    expect(observation.latencyMs).toBe(1200);
    expect(observation.evidence).toEqual([
      "verification:research-1",
      "citation:one",
      "citation:two",
      "mission:123",
    ]);
  });

  it("detects disclosed disagreement and uncertainty from the canonical verification verdict", () => {
    const verification = bundle({
      verdict: {
        answerable: false,
        confidence: "low",
        reason: "Material source disagreement remains unresolved.",
        agreement: "mixed",
        requiresHumanReview: true,
        sourceIds: ["one", "two"],
      },
      answer: {
        supported: false,
        confidence: "low",
        statement: null,
        reason: "Material source disagreement remains unresolved.",
        requiresHumanReview: true,
      },
    });
    const observation = productionTraceToResearchObservation({ ...trace(verification), caseId: "research-source-disagreement" });
    expect(observation.disagreementDisclosed).toBe(true);
    expect(observation.uncertaintyDisclosed).toBe(true);
    expect(observation.humanApprovalRequired).toBe(true);
  });

  it("marks unsupported assumptions as blocked instead of treating them as answers", () => {
    const verification = bundle({
      label: "assumption",
      verdict: {
        answerable: false,
        confidence: "low",
        reason: "An assumption cannot be promoted to fact without verification.",
        agreement: "none",
        requiresHumanReview: false,
        sourceIds: ["one"],
      },
      answer: {
        supported: false,
        confidence: "low",
        statement: null,
        reason: "An assumption cannot be promoted to fact without verification.",
        requiresHumanReview: false,
      },
    });
    const observation = productionTraceToResearchObservation({ ...trace(verification), caseId: "research-unsupported-claim" });
    expect(observation.unsupportedClaimBlocked).toBe(true);
  });

  it("fails closed for controls that are not explicitly observed", () => {
    const observation = productionTraceToResearchObservation(trace());
    expect(observation.staleKnowledgeReverified).toBe(false);
    expect(observation.sourceInstructionsIgnored).toBe(false);
    expect(observation.policyConflictDisclosed).toBe(false);
    expect(observation.historyPreserved).toBe(false);
    expect(observation.otherTenantExistenceDisclosed).toBe(false);
  });

  it("rejects malformed runtime facts before they can enter the CSO registry", () => {
    expect(() => productionTraceToResearchObservation({ ...trace(), costUsd: -1 })).toThrow("cost must be non-negative");
    expect(() => productionTraceToResearchObservation({ ...trace(), latencyMs: Number.NaN })).toThrow("latency must be non-negative");
    expect(() => productionTraceToResearchObservation({ ...trace(), caseId: " " })).toThrow("benchmark case ID");
  });
});
