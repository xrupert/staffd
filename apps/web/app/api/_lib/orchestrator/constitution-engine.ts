import type { ExecutiveOfficerId } from "./executive-officers";

export type ConstitutionRisk = "low" | "medium" | "high";

export type ConstitutionContext = {
  officer: ExecutiveOfficerId;
  intendsExecution: boolean;
  risk: ConstitutionRisk;
  irreversible: boolean;
  ownerApprovalRequired: boolean;
  ownerApproved: boolean;
  evidenceRequired: boolean;
  evidenceSatisfied: boolean;
  uncertaintyKnown: boolean;
  uncertaintyDisclosed: boolean;
  tenantBoundaryVerified: boolean;
  policyConflictDetected: boolean;
  policyConflictDisclosed: boolean;
  learningProposed: boolean;
  learningEvidenceSatisfied: boolean;
  learningOwnerApproved: boolean;
  inversionRequired: boolean;
  inversionCompleted: boolean;
  costBudgetUsd?: number | null;
  estimatedCostUsd?: number | null;
};

export type ConstitutionViolationCode =
  | "execution_authority"
  | "approval_required"
  | "evidence_required"
  | "uncertainty_hidden"
  | "tenant_boundary_unverified"
  | "policy_conflict_hidden"
  | "learning_unproven"
  | "learning_unapproved"
  | "inversion_required"
  | "cost_budget_exceeded"
  | "cost_unknown";

export type ConstitutionViolation = {
  code: ConstitutionViolationCode;
  reason: string;
};

export type ConstitutionVerdict = {
  allowed: boolean;
  violations: ConstitutionViolation[];
};

function add(violations: ConstitutionViolation[], code: ConstitutionViolationCode, reason: string): void {
  violations.push({ code, reason });
}

export function evaluateConstitution(context: ConstitutionContext): ConstitutionVerdict {
  const violations: ConstitutionViolation[] = [];

  if (context.intendsExecution && context.officer !== "coo") {
    add(violations, "execution_authority", "Only the COO may coordinate execution.");
  }

  const consequential = context.risk === "high" || context.irreversible;
  if ((context.ownerApprovalRequired || consequential) && !context.ownerApproved) {
    add(violations, "approval_required", "Consequential or explicitly gated work requires owner approval before execution.");
  }

  if (context.evidenceRequired && !context.evidenceSatisfied) {
    add(violations, "evidence_required", "Required evidence has not met the applicable proof threshold.");
  }

  if (context.uncertaintyKnown && !context.uncertaintyDisclosed) {
    add(violations, "uncertainty_hidden", "Known uncertainty must be disclosed rather than presented as settled fact.");
  }

  if (!context.tenantBoundaryVerified) {
    add(violations, "tenant_boundary_unverified", "Tenant ownership and authorization must be verified before data access or action.");
  }

  if (context.policyConflictDetected && !context.policyConflictDisclosed) {
    add(violations, "policy_conflict_hidden", "Conflicts with approved business policy must be disclosed and cannot be silently overwritten.");
  }

  if (context.learningProposed) {
    if (!context.learningEvidenceSatisfied) {
      add(violations, "learning_unproven", "Observed behavior cannot become learned knowledge without sufficient repeated evidence.");
    }
    if (!context.learningOwnerApproved) {
      add(violations, "learning_unapproved", "Durable business learning requires explicit owner approval.");
    }
  }

  if (context.inversionRequired && !context.inversionCompleted) {
    add(violations, "inversion_required", "High-impact work requiring inversion cannot proceed before the failure-mode pass is complete.");
  }

  if (context.costBudgetUsd != null) {
    if (!Number.isFinite(context.costBudgetUsd) || context.costBudgetUsd < 0) {
      throw new Error("Constitution cost budget must be non-negative");
    }
    if (context.estimatedCostUsd == null || !Number.isFinite(context.estimatedCostUsd) || context.estimatedCostUsd < 0) {
      add(violations, "cost_unknown", "Cost must be known before budget-constrained execution can proceed.");
    } else if (context.estimatedCostUsd > context.costBudgetUsd) {
      add(violations, "cost_budget_exceeded", "Estimated execution cost exceeds the approved budget.");
    }
  }

  return { allowed: violations.length === 0, violations };
}

export function assertConstitution(context: ConstitutionContext): void {
  const verdict = evaluateConstitution(context);
  if (!verdict.allowed) {
    throw new Error(`STAFFD Constitution blocked execution: ${verdict.violations.map((item) => item.code).join(", ")}`);
  }
}
