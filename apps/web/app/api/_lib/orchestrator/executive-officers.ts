export type ExecutiveOfficerId = "ceo" | "coo" | "cso";

export type ExecutiveOfficer = {
  id: ExecutiveOfficerId;
  initials: Uppercase<ExecutiveOfficerId>;
  publicTitle: string;
  internalMandate: string;
  primaryQuestion: string;
  responsibilities: readonly string[];
  mayExecute: boolean;
};

export const EXECUTIVE_OFFICERS: Readonly<Record<ExecutiveOfficerId, ExecutiveOfficer>> = {
  ceo: {
    id: "ceo",
    initials: "CEO",
    publicTitle: "Chief Executive Officer",
    internalMandate: "Executive prioritization and business-value judgment",
    primaryQuestion: "Is this the most valuable thing the business should do next?",
    responsibilities: [
      "rank problems, opportunities, and proposed work by value, urgency, risk, and reversibility",
      "challenge low-value activity before resources are committed",
      "explain why a recommendation deserves the owner's attention",
      "select the next best outcome without directly executing work",
    ],
    mayExecute: false,
  },
  coo: {
    id: "coo",
    initials: "COO",
    publicTitle: "Chief Orchestrating Officer",
    internalMandate: "Chief orchestration across mission graphs, workers, harnesses, and repair loops",
    primaryQuestion: "How do we turn the chosen outcome into governed completed work?",
    responsibilities: [
      "translate approved outcomes into dependency-aware execution plans",
      "coordinate departments, workers, tools, approvals, budgets, and evidence",
      "apply harness, loop, graph, inversion, and recovery policies",
      "report progress, blockers, completion evidence, and required owner decisions",
    ],
    mayExecute: true,
  },
  cso: {
    id: "cso",
    initials: "CSO",
    publicTitle: "Chief Science Officer",
    internalMandate: "Evidence, experimentation, causal discipline, and guarded organizational learning",
    primaryQuestion: "Can we prove this conclusion or result well enough to rely on it?",
    responsibilities: [
      "set evidence thresholds and identify unsupported assumptions",
      "design tests, baselines, success measures, and kill criteria",
      "detect false correlation, weak samples, vanity metrics, and overfitting",
      "decide whether observed outcomes justify learning or policy promotion",
    ],
    mayExecute: false,
  },
};

export function executiveOfficer(id: ExecutiveOfficerId): ExecutiveOfficer {
  return EXECUTIVE_OFFICERS[id];
}

export function executiveOfficerPublicLabel(id: ExecutiveOfficerId): string {
  const officer = executiveOfficer(id);
  return `${officer.initials} — ${officer.publicTitle}`;
}
