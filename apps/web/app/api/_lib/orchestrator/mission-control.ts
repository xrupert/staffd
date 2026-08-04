export type MissionRisk = "low" | "medium" | "high" | "critical";
export type MissionStatus =
  | "draft"
  | "planned"
  | "running"
  | "waiting_for_approval"
  | "repairing"
  | "completed"
  | "failed";

export type MissionRequest = {
  goal: string;
  requestedBy: string;
  deadline?: string;
  budgetCredits?: number;
  constraints?: string[];
  successCriteria?: string[];
};

export type MissionCapability =
  | "business_architecture"
  | "marketing"
  | "legal"
  | "sales"
  | "operations"
  | "analytics"
  | "content"
  | "customer_support"
  | "finance";

export type MissionStep = {
  id: string;
  title: string;
  capability: MissionCapability;
  dependsOn: string[];
  approvalRequired: boolean;
  successCriteria: string[];
  maxAttempts: number;
};

export type MissionPlan = {
  id: string;
  goal: string;
  requestedBy: string;
  status: MissionStatus;
  risk: MissionRisk;
  budgetCredits: number;
  constraints: string[];
  successCriteria: string[];
  steps: MissionStep[];
};

export type HarnessPolicy = {
  timeoutMs: number;
  maxAttempts: number;
  approvalRequired: boolean;
  allowedTools: string[];
  maxCostCredits: number;
};

export type StepAttempt = {
  attempt: number;
  output: string;
  passed: boolean;
  failureFingerprint?: string;
};

export type LoopDecision =
  | { action: "complete" }
  | { action: "repair"; nextAttempt: number }
  | { action: "escalate"; reason: "attempt_limit" | "no_progress" | "approval_required" };

const CAPABILITY_PATTERNS: Array<{ capability: MissionCapability; pattern: RegExp }> = [
  { capability: "legal", pattern: /legal|contract|compliance|policy|terms|privacy/i },
  { capability: "marketing", pattern: /marketing|campaign|viral|promotion|launch/i },
  { capability: "content", pattern: /video|social|post|copy|newsletter|content/i },
  { capability: "sales", pattern: /sales|lead|pipeline|proposal|outreach/i },
  { capability: "customer_support", pattern: /support|ticket|customer response|complaint/i },
  { capability: "finance", pattern: /invoice|expense|budget|finance|payment/i },
  { capability: "analytics", pattern: /analytics|measure|report|performance|conversion/i },
  { capability: "operations", pattern: /operations|process|workflow|schedule|coordinate/i },
];

function missionId(goal: string, requestedBy: string): string {
  const source = `${requestedBy}:${goal}`.toLowerCase();
  let hash = 0;
  for (const character of source) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `mission-${hash.toString(36)}`;
}

export function inferMissionCapabilities(goal: string): MissionCapability[] {
  const capabilities = CAPABILITY_PATTERNS.filter(({ pattern }) => pattern.test(goal)).map(
    ({ capability }) => capability,
  );

  return ["business_architecture", ...new Set(capabilities)] as MissionCapability[];
}

export function assessMissionRisk(capabilities: MissionCapability[], constraints: string[]): MissionRisk {
  if (
    capabilities.includes("legal") ||
    constraints.some((value) => /regulated|sensitive|public/i.test(value))
  ) {
    return "high";
  }
  if (capabilities.length >= 5) return "high";
  if (capabilities.length >= 3) return "medium";
  return "low";
}

export function planMission(request: MissionRequest): MissionPlan {
  const goal = request.goal.trim();
  if (!goal) throw new Error("Mission goal is required");
  if (!request.requestedBy.trim()) throw new Error("Mission requester is required");

  const capabilities = inferMissionCapabilities(goal);
  const risk = assessMissionRisk(capabilities, request.constraints ?? []);
  const architectureStepId = "step-1-business_architecture";
  const steps: MissionStep[] = capabilities.map((capability, index) => ({
    id: `step-${index + 1}-${capability}`,
    title:
      capability === "business_architecture"
        ? "Clarify the outcome and design the mission"
        : `Execute ${capability.replaceAll("_", " ")} work`,
    capability,
    dependsOn: index === 0 ? [] : [architectureStepId],
    approvalRequired: capability === "legal" || risk === "critical",
    successCriteria:
      capability === "business_architecture"
        ? ["Goal, audience, constraints, deliverables, and success measures are explicit"]
        : [`The ${capability.replaceAll("_", " ")} deliverable satisfies the mission criteria`],
    maxAttempts: risk === "high" || risk === "critical" ? 3 : 2,
  }));

  return {
    id: missionId(goal, request.requestedBy),
    goal,
    requestedBy: request.requestedBy,
    status: "planned",
    risk,
    budgetCredits: request.budgetCredits ?? Math.max(10, steps.length * 5),
    constraints: request.constraints ?? [],
    successCriteria:
      request.successCriteria?.length
        ? request.successCriteria
        : ["The requested business outcome is delivered and verified"],
    steps,
  };
}

export function harnessPolicyFor(step: MissionStep, plan: MissionPlan): HarnessPolicy {
  return {
    timeoutMs: step.capability === "content" ? 180_000 : 60_000,
    maxAttempts: step.maxAttempts,
    approvalRequired: step.approvalRequired,
    allowedTools: [step.capability, "pocketbase", "observability"],
    maxCostCredits: Math.max(1, Math.floor(plan.budgetCredits / plan.steps.length)),
  };
}

export function nextLoopDecision(attempts: StepAttempt[], policy: HarnessPolicy): LoopDecision {
  const latest = attempts.at(-1);
  if (!latest) {
    return policy.approvalRequired
      ? { action: "escalate", reason: "approval_required" }
      : { action: "repair", nextAttempt: 1 };
  }
  if (latest.passed) return { action: "complete" };

  const previous = attempts.at(-2);
  if (
    previous?.failureFingerprint &&
    previous.failureFingerprint === latest.failureFingerprint
  ) {
    return { action: "escalate", reason: "no_progress" };
  }
  if (attempts.length >= policy.maxAttempts) {
    return { action: "escalate", reason: "attempt_limit" };
  }

  return { action: "repair", nextAttempt: attempts.length + 1 };
}

export function validateExecutionGraph(steps: MissionStep[]): string[] {
  const ids = new Set(steps.map((step) => step.id));
  const errors: string[] = [];
  const dependencies = new Map(steps.map((step) => [step.id, step.dependsOn]));

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) errors.push(`${step.id} depends on missing step ${dependency}`);
      if (dependency === step.id) errors.push(`${step.id} depends on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (ids.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const step of steps) {
    if (visit(step.id)) {
      errors.push("Mission execution graph contains a cycle");
      break;
    }
  }

  return errors;
}
