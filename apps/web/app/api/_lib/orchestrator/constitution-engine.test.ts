import { describe, expect, it } from "vitest";
import { assertConstitution, evaluateConstitution, type ConstitutionContext } from "./constitution-engine";

function valid(overrides: Partial<ConstitutionContext> = {}): ConstitutionContext {
  return {
    officer: "coo",
    intendsExecution: true,
    risk: "medium",
    irreversible: false,
    ownerApprovalRequired: false,
    ownerApproved: false,
    evidenceRequired: true,
    evidenceSatisfied: true,
    uncertaintyKnown: false,
    uncertaintyDisclosed: false,
    tenantBoundaryVerified: true,
    policyConflictDetected: false,
    policyConflictDisclosed: false,
    learningProposed: false,
    learningEvidenceSatisfied: false,
    learningOwnerApproved: false,
    inversionRequired: false,
    inversionCompleted: false,
    costBudgetUsd: 1,
    estimatedCostUsd: 0.2,
    ...overrides,
  };
}

describe("STAFFD Constitution Engine", () => {
  it("allows a governed COO execution when all applicable rules pass", () => {
    expect(evaluateConstitution(valid())).toEqual({ allowed: true, violations: [] });
    expect(() => assertConstitution(valid())).not.toThrow();
  });

  it("permits only the COO to coordinate execution", () => {
    const verdict = evaluateConstitution(valid({ officer: "ceo" }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map((item) => item.code)).toContain("execution_authority");
  });

  it("requires approval for high-risk or irreversible actions even when a caller forgot to request it", () => {
    expect(evaluateConstitution(valid({ risk: "high" })).violations.map((item) => item.code)).toContain("approval_required");
    expect(evaluateConstitution(valid({ irreversible: true })).violations.map((item) => item.code)).toContain("approval_required");
  });

  it("blocks missing evidence, hidden uncertainty, unverified tenancy, and hidden policy conflicts", () => {
    const verdict = evaluateConstitution(valid({
      evidenceSatisfied: false,
      uncertaintyKnown: true,
      uncertaintyDisclosed: false,
      tenantBoundaryVerified: false,
      policyConflictDetected: true,
      policyConflictDisclosed: false,
    }));
    expect(verdict.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      "evidence_required",
      "uncertainty_hidden",
      "tenant_boundary_unverified",
      "policy_conflict_hidden",
    ]));
  });

  it("prevents silent learning without proof and owner approval", () => {
    const verdict = evaluateConstitution(valid({ learningProposed: true }));
    expect(verdict.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      "learning_unproven",
      "learning_unapproved",
    ]));
  });

  it("enforces inversion before high-impact work when required", () => {
    const verdict = evaluateConstitution(valid({ inversionRequired: true, inversionCompleted: false }));
    expect(verdict.violations.map((item) => item.code)).toContain("inversion_required");
  });

  it("fails closed for unknown or excessive cost under an approved budget", () => {
    expect(evaluateConstitution(valid({ estimatedCostUsd: null })).violations.map((item) => item.code)).toContain("cost_unknown");
    expect(evaluateConstitution(valid({ estimatedCostUsd: 2 })).violations.map((item) => item.code)).toContain("cost_budget_exceeded");
    expect(() => evaluateConstitution(valid({ costBudgetUsd: -1 }))).toThrow("non-negative");
  });

  it("returns all blocking rules so the COO can repair the plan in one pass", () => {
    const verdict = evaluateConstitution(valid({
      officer: "cso",
      risk: "high",
      evidenceSatisfied: false,
      tenantBoundaryVerified: false,
      inversionRequired: true,
    }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.length).toBeGreaterThanOrEqual(5);
    expect(() => assertConstitution(valid({ officer: "cso", risk: "high" }))).toThrow("STAFFD Constitution blocked execution");
  });
});
