import type { EvidenceLabel, ResearchSource } from "./research-evidence";
import { verifyResearchClaim, type ResearchVerificationBundle } from "./research-verification";

export type RefreshRelationship = Exclude<ResearchSource["supports"], "context_only"> | "context_only";

export type RefreshComparisonInput = {
  topic: string;
  claim: string;
  label: EvidenceLabel;
  timeSensitive?: boolean;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    sourceClass: ResearchSource["sourceClass"];
    retrievedAt: string;
    publishedAt?: string | null;
    excerpt?: string;
    relationship: RefreshRelationship;
  }>;
};

export type RefreshComparisonOutcome = "confirmed" | "weakened" | "contradicted" | "unclassified";

export type RefreshComparison = {
  outcome: RefreshComparisonOutcome;
  bundle: ResearchVerificationBundle | null;
  reason: string;
  blocksDependentActions: boolean;
  requiresOwnerReview: boolean;
};

export function compareRefreshedEvidence(input: RefreshComparisonInput, now = new Date()): RefreshComparison {
  if (input.sources.length === 0) throw new Error("Fresh evidence is required");
  if (input.sources.some((source) => source.relationship === "context_only")) {
    return {
      outcome: "unclassified",
      bundle: null,
      reason: "Every fresh source must be classified before trusted knowledge can change.",
      blocksDependentActions: false,
      requiresOwnerReview: true,
    };
  }

  const bundle = verifyResearchClaim({
    topic: input.topic,
    claim: input.claim,
    label: input.label,
    timeSensitive: input.timeSensitive,
    sources: input.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      sourceClass: source.sourceClass,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
      excerpt: source.excerpt,
      supports: source.relationship,
    })),
  }, now);

  const hasContradiction = input.sources.some((source) => source.relationship === "contradicts");
  if (hasContradiction) {
    return {
      outcome: "contradicted",
      bundle,
      reason: "Current evidence contradicts the previously approved conclusion.",
      blocksDependentActions: true,
      requiresOwnerReview: true,
    };
  }
  if (!bundle.verdict.answerable) {
    return {
      outcome: "weakened",
      bundle,
      reason: "Current evidence no longer meets the threshold required to rely on this conclusion.",
      blocksDependentActions: input.timeSensitive ?? false,
      requiresOwnerReview: true,
    };
  }
  return {
    outcome: "confirmed",
    bundle,
    reason: "Current evidence continues to support the approved conclusion.",
    blocksDependentActions: false,
    requiresOwnerReview: bundle.verdict.requiresHumanReview,
  };
}
