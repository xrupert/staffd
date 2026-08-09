import { evaluateConstitution, type ConstitutionRisk, type ConstitutionVerdict } from "./constitution-engine";
import type { MissionRecord } from "./mission-repository";

function constitutionRiskForMission(mission: MissionRecord): ConstitutionRisk {
  if (mission.risk === "low") return "low";
  if (mission.risk === "medium") return "medium";
  return "high";
}

export function evaluateMissionStartConstitution(mission: MissionRecord): ConstitutionVerdict {
  const approvalSatisfied = !mission.approval_required || mission.status === "planned";

  return evaluateConstitution({
    officer: "coo",
    intendsExecution: true,
    risk: constitutionRiskForMission(mission),
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
