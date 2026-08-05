import type { MissionCapability, MissionPlan, MissionRisk } from "./mission-control";

export type FailureLikelihood = "low" | "medium" | "high";
export type FailureSeverity = "low" | "medium" | "high" | "critical";

export type MissionFailureMode = {
  id: string;
  capability: MissionCapability;
  failure: string;
  likelihood: FailureLikelihood;
  severity: FailureSeverity;
  earlyWarning: string;
  preventiveControl: string;
  recoveryAction: string;
  killCriterion: string;
};

export type InvertedMissionPlan = MissionPlan & {
  failureModes: MissionFailureMode[];
  inversionReviewed: true;
};

const FAILURE_LIBRARY: Record<
  MissionCapability,
  Omit<MissionFailureMode, "id" | "capability" | "likelihood" | "severity">[]
> = {
  business_architecture: [{
    failure: "The mission solves the wrong problem or optimizes a proxy instead of the business outcome.",
    earlyWarning: "The deliverable is clear but the user, decision, or measurable outcome is still ambiguous.",
    preventiveControl: "Restate the desired outcome, affected user, constraints, evidence, and definition of done before execution.",
    recoveryAction: "Pause execution, reframe the mission, and rebuild downstream steps from the corrected outcome.",
    killCriterion: "Stop if the owner cannot confirm the outcome and success measure without technical language.",
  }],
  marketing: [{
    failure: "The campaign reaches the wrong audience with a vague or unprovable offer.",
    earlyWarning: "Engagement exists but qualified response, conversion intent, or message relevance is weak.",
    preventiveControl: "Define one audience, one problem, one honest promise, and one measurable next action.",
    recoveryAction: "Pause the weak variant, tighten audience-message fit, and retest against a controlled baseline.",
    killCriterion: "Stop or redesign when the agreed conversion threshold is missed after the minimum valid sample.",
  }],
  content: [{
    failure: "The content is generic, off-brand, unclear, or polished without moving the audience toward action.",
    earlyWarning: "Reviewers cannot identify the audience, promise, or next step after one pass.",
    preventiveControl: "Grade every asset for brand fit, clarity, specificity, credibility, and actionability.",
    recoveryAction: "Return the asset to the smallest failing criterion and regenerate only the defective portion.",
    killCriterion: "Reject content that requires explanation to communicate its core promise or call to action.",
  }],
  legal: [{
    failure: "The mission creates legal, regulatory, contractual, or trust exposure through unsupported assumptions.",
    earlyWarning: "A material claim, obligation, jurisdiction, consent, or policy requirement lacks an authoritative source.",
    preventiveControl: "Require source-backed review, explicit assumptions, jurisdiction checks, and human approval before external use.",
    recoveryAction: "Block the affected action, identify the unsupported clause or assumption, and obtain qualified review.",
    killCriterion: "Do not execute when a high-impact legal assumption remains unresolved or uncited.",
  }],
  sales: [{
    failure: "The sales action is generic, mistimed, or disconnected from the buyer's real problem and decision process.",
    earlyWarning: "Follow-ups repeat activity without new evidence, stakeholder movement, or a defined next step.",
    preventiveControl: "Anchor outreach to verified context, buyer value, objections, timing, and one mutual next action.",
    recoveryAction: "Stop the sequence, reassess qualification and stakeholders, then prepare a context-specific follow-up.",
    killCriterion: "Stop automated outreach when replies, opt-outs, or qualification evidence show poor fit.",
  }],
  customer_support: [{
    failure: "The response is fast but fails to resolve the customer's actual problem or damages trust.",
    earlyWarning: "The customer repeats the issue, sentiment worsens, or the proposed answer lacks account context.",
    preventiveControl: "Confirm the issue, desired resolution, account facts, policy limits, and ownership before responding.",
    recoveryAction: "Escalate with the full context, acknowledge the gap, and provide a concrete recovery commitment.",
    killCriterion: "Do not send when identity, entitlement, policy, or promised remedy is uncertain.",
  }],
  finance: [{
    failure: "The financial action is posted incorrectly, unsupported, duplicated, or inconsistent with policy and accounting evidence.",
    earlyWarning: "The account, amount, period, tax treatment, approval, or source document is missing or contradictory.",
    preventiveControl: "Require source documents, account mapping, duplicate checks, policy validation, and approval for material entries.",
    recoveryAction: "Reverse or hold the transaction, reconcile the evidence, and document the corrected treatment.",
    killCriterion: "Do not post when the accounting treatment or authoritative support remains materially uncertain.",
  }],
  operations: [{
    failure: "The workflow depends on hidden manual steps, unclear ownership, or timing assumptions that cause silent stalls.",
    earlyWarning: "Work remains idle, dependencies lack owners, or completion requires undocumented intervention.",
    preventiveControl: "Assign every dependency an owner, deadline, evidence requirement, timeout, and recovery path.",
    recoveryAction: "Surface the blocked dependency, reassign ownership, and resume from the last verified checkpoint.",
    killCriterion: "Escalate when a critical dependency exceeds its timeout without a verified recovery plan.",
  }],
  analytics: [{
    failure: "The mission appears successful because it measures activity or vanity metrics instead of the intended outcome.",
    earlyWarning: "Reported improvement cannot be tied to a baseline, business result, or credible causal explanation.",
    preventiveControl: "Define the baseline, decision metric, attribution limits, minimum sample, and falsifying evidence in advance.",
    recoveryAction: "Recalculate from validated data, disclose uncertainty, and run a better-controlled measurement.",
    killCriterion: "Reject conclusions when the data cannot distinguish the intervention from noise or selection bias.",
  }],
};

function likelihoodFor(capability: MissionCapability, risk: MissionRisk): FailureLikelihood {
  if (risk === "critical" || risk === "high") return "high";
  if (["legal", "finance", "operations"].includes(capability)) return "medium";
  return risk === "medium" ? "medium" : "low";
}

function severityFor(capability: MissionCapability, risk: MissionRisk): FailureSeverity {
  if (risk === "critical") return "critical";
  if (["legal", "finance"].includes(capability)) return "high";
  if (risk === "high") return "high";
  return "medium";
}

export function buildFailureLedger(capabilities: MissionCapability[], risk: MissionRisk): MissionFailureMode[] {
  return capabilities.flatMap((capability) =>
    FAILURE_LIBRARY[capability].map((entry, index) => ({
      id: `failure-${capability}-${index + 1}`,
      capability,
      likelihood: likelihoodFor(capability, risk),
      severity: severityFor(capability, risk),
      ...entry,
    })),
  );
}

export function invertMissionPlan(plan: MissionPlan): InvertedMissionPlan {
  const capabilities = [...new Set(plan.steps.map((step) => step.capability))];
  const failureModes = buildFailureLedger(capabilities, plan.risk);
  const errors = validateFailureLedger(capabilities, failureModes);
  if (errors.length) throw new Error(`Mission inversion failed: ${errors.join("; ")}`);
  return { ...plan, failureModes, inversionReviewed: true };
}

export function validateFailureLedger(
  capabilities: MissionCapability[],
  failureModes: MissionFailureMode[],
): string[] {
  const errors: string[] = [];
  const covered = new Set(failureModes.map((mode) => mode.capability));
  for (const capability of capabilities) {
    if (!covered.has(capability)) errors.push(`Missing failure mode for ${capability}`);
  }
  for (const mode of failureModes) {
    if (!mode.earlyWarning.trim()) errors.push(`${mode.id} is missing an early warning`);
    if (!mode.preventiveControl.trim()) errors.push(`${mode.id} is missing a preventive control`);
    if (!mode.recoveryAction.trim()) errors.push(`${mode.id} is missing a recovery action`);
    if (!mode.killCriterion.trim()) errors.push(`${mode.id} is missing a kill criterion`);
  }
  return errors;
}
