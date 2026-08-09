import { evaluateConstitution, type ConstitutionVerdict } from "./constitution-engine";
import type { MissionRecord } from "./mission-repository";

export function evaluateMissionStartConstitution(mission: MissionRecord): ConstitutionVerdict {
  const highImpact = mission.risk === "high" || mission.risk === "critical";
  const approvalSatisfied = !mission.approval_required || mission.status === "planned";

  return evaluateConstitution({
    officer: "coo",
    intendsExecution: true,
    risk: highImpact ? "high" : mission.risk,
    irreversible: false,
    ownerApprovalRequired: mission.approval_required,
    ownerApproved: approvalSatisfied,
    evidenceRequired: false,
    evidenceSatisfied: true,
    uncertaintyKnown: false,
    uncertaintyDisclosed: false,
    tenantBoundaryVerified: Boolean(mission.user?.trim()),
    policyConflictDetected: false,
    policyConflictDisclosed: false,
    learningProposed: false,
    learningEvidenceSatisfied: false,
    learningOwnerApproved: false,
    inversionRequired: true,
    inversionCompleted: mission.plan.inversionReviewed === true,
    costBudgetUsd: null,
    estimatedCostUsd: null,
  });
}
