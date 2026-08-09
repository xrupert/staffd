import type { ResearchVerificationBundle } from "../orchestrator/research-verification";
import type { ResearchEvalObservation } from "./research-answer-runner";

const AUTHORITATIVE_SOURCE_CLASSES = new Set([
  "approved_internal",
  "government_or_regulator",
  "primary_documentation",
  "primary_research",
]);

export type ResearchProductionTrace = {
  caseId: string;
  verification: ResearchVerificationBundle;
  answerCorrect: boolean;
  completed: boolean;
  businessUseful: boolean;
  costUsd: number;
  latencyMs: number;
  staleKnowledgeReverified?: boolean;
  sourceInstructionsIgnored?: boolean;
  secretsDisclosed?: boolean;
  autonomousHighRiskActionAttempted?: boolean;
  policyConflictDisclosed?: boolean;
  ownerReviewRequired?: boolean;
  historyPreserved?: boolean;
  crossTenantAccessBlocked?: boolean;
  otherTenantExistenceDisclosed?: boolean;
  evidence?: string[];
};

function independentAuthorityCount(bundle: ResearchVerificationBundle): number {
  const hosts = new Set<string>();
  for (const citation of bundle.citations) {
    if (!AUTHORITATIVE_SOURCE_CLASSES.has(citation.sourceClass) || citation.relationship !== "supports") continue;
    try {
      hosts.add(new URL(citation.url).hostname.toLowerCase());
    } catch {
      // Verification already rejects invalid URLs. Fail closed if a historical trace is malformed.
    }
  }
  return hosts.size;
}

function authoritativeSourceCount(bundle: ResearchVerificationBundle): number {
  return bundle.citations.filter((citation) => (
    AUTHORITATIVE_SOURCE_CLASSES.has(citation.sourceClass) && citation.relationship === "supports"
  )).length;
}

function validateRuntime(trace: ResearchProductionTrace): void {
  if (!trace.caseId.trim()) throw new Error("Production research trace requires a benchmark case ID");
  if (!Number.isFinite(trace.costUsd) || trace.costUsd < 0) throw new Error("Production research trace cost must be non-negative");
  if (!Number.isFinite(trace.latencyMs) || trace.latencyMs < 0) throw new Error("Production research trace latency must be non-negative");
}

export function productionTraceToResearchObservation(trace: ResearchProductionTrace): ResearchEvalObservation {
  validateRuntime(trace);
  const verification = trace.verification;
  const reason = verification.answer.reason.toLowerCase();
  const unresolvedDisagreement = verification.verdict.agreement === "mixed";
  const unsupported = !verification.answer.supported
    && (verification.label === "assumption"
      || verification.label === "unknown"
      || reason.includes("no source supports")
      || reason.includes("cannot be promoted"));

  return {
    caseId: trace.caseId.trim(),
    answerCorrect: trace.answerCorrect,
    citationsPresent: verification.citations.length > 0,
    authoritativeSourceCount: authoritativeSourceCount(verification),
    independentAuthorityCount: independentAuthorityCount(verification),
    disagreementDisclosed: unresolvedDisagreement && reason.includes("disagreement"),
    uncertaintyDisclosed: !verification.answer.supported || verification.answer.confidence !== "high",
    staleKnowledgeReverified: trace.staleKnowledgeReverified === true,
    unsupportedClaimBlocked: unsupported,
    sourceInstructionsIgnored: trace.sourceInstructionsIgnored === true,
    secretsDisclosed: trace.secretsDisclosed === true,
    humanApprovalRequired: verification.answer.requiresHumanReview,
    autonomousHighRiskActionAttempted: trace.autonomousHighRiskActionAttempted === true,
    policyConflictDisclosed: trace.policyConflictDisclosed === true,
    ownerReviewRequired: trace.ownerReviewRequired === true,
    historyPreserved: trace.historyPreserved === true,
    crossTenantAccessBlocked: trace.crossTenantAccessBlocked === true,
    otherTenantExistenceDisclosed: trace.otherTenantExistenceDisclosed === true,
    completed: trace.completed,
    businessUseful: trace.businessUseful,
    costUsd: trace.costUsd,
    latencyMs: trace.latencyMs,
    evidence: [...new Set([
      `verification:${verification.id}`,
      ...verification.citations.map((citation) => `citation:${citation.id}`),
      ...(trace.evidence ?? []),
    ].map((item) => item.trim()).filter(Boolean))],
  };
}
