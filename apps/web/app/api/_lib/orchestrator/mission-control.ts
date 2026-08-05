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
  { capability: "marketing", pattern: /marketing|campaign|viral|promotion|launch|audience/i },
  { capability: "content", pattern: /video|social|post|copy|newsletter|content|creative|image/i },
  { capability: "sales", pattern: /sales|lead|pipeline|proposal|outreach|prospect|follow[ -]?up/i },
  { capability: "customer_support", pattern: /support|ticket|customer response|complaint|reply/i },
  { capability: "finance", pattern: /invoice|expense|budget|finance|payment|revenue/i },
  { capability: "analytics", pattern: /analytics|measure|report|performance|conversion|track/i },
  { capability: "operations", pattern: /operations|process|workflow|schedule|coordinate|recurring/i },
];

const OUTBOUND_PATTERN = /\b(send|publish|post|email|message|contact|call|launch|distribute|deliver|reply|respond|outreach)\b/i;
const OUTBOUND_CAPABILITIES = new Set<MissionCapability>([
  "marketing",
  "content",
  "sales",
  "customer_support",
]);

const STEP_TITLES: Record<MissionCapability, string> = {
  business_architecture: "Clarify the outcome and design the mission",
  marketing: "Design the campaign and audience strategy",
  content: "Create the required content and creative assets",
  legal: "Review legal, policy, and compliance requirements",
  sales: "Prepare and execute the sales follow-up",
  customer_support: "Prepare the customer response",
  finance: "Review the financial impact and payment requirements",
  operations: "Coordinate timing, workflow, and delivery",
  analytics: "Measure results and verify the outcome",
};

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

export function missionRequiresOutboundApproval(goal: string, capability: MissionCapability): boolean {
  return OUTBOUND_CAPABILITIES.has(capability) && OUTBOUND_PATTERN.test(goal);
}

function dependencyIdsFor(
  capability: MissionCapability,
  stepsByCapability: Partial<Record<MissionCapability, string>>,
): string[] {
  const architecture = stepsByCapability.business_architecture;
  if (!architecture || capability === "business_architecture") return [];

  const firstAvailable = (...candidates: MissionCapability[]): string | undefined =>
    candidates.map((candidate) => stepsByCapability[candidate]).find(Boolean);

  switch (capability) {
    case "marketing":
    case "finance":
      return [architecture];
    case "content":
      return [firstAvailable("marketing") ?? architecture];
    case "legal":
      return [firstAvailable("content", "marketing") ?? architecture];
    case "sales":
    case "customer_support":
      return [firstAvailable("legal", "content", "marketing") ?? architecture];
    case "operations":
      return [
        ...new Set(
          ["legal", "sales", "customer_support", "content", "marketing", "finance"]
            .map((candidate) => stepsByCapability[candidate as MissionCapability])
            .filter((id): id is string => Boolean(id)),
        ),
      ].length
        ? [
            ...new Set(
              ["legal", "sales", "customer_support", "content", "marketing", "finance"]
                .map((candidate) => stepsByCapability[candidate as MissionCapability])
                .filter((id): id is string => Boolean(id)),
            ),
          ]
        : [architecture];
    case "analytics": {
      const executionSteps = Object.entries(stepsByCapability)
        .filter(([candidate]) => candidate !== "business_architecture" && candidate !== "analytics")
        .map(([, id]) => id)
        .filter((id): id is string => Boolean(id));
      return executionSteps.length ? executionSteps : [architecture];
    }
    default:
      return [architecture];
  }
}

export function planMission(request: MissionRequest): MissionPlan {
  const goal = request.goal.trim();
  if (!goal) throw new Error("Mission goal is required");
  if (!request.requestedBy.trim()) throw new Error("Mission requester is required");

  const capabilities = inferMissionCapabilities(goal);
  const risk = assessMissionRisk(capabilities, request.constraints ?? []);
  const stepsByCapability = Object.fromEntries(
    capabilities.map((capability, index) => [capability, `step-${index + 1}-${capability}`]),
  ) as Partial<Record<MissionCapability, string>>;

  const steps: MissionStep[] = capabilities.map((capability) => ({
    id: stepsByCapability[capability]!,
    title: STEP_TITLES[capability],
    capability,
    dependsOn: dependencyIdsFor(capability, stepsByCapability),
    approvalRequired:
      capability === "legal" || missionRequiresOutboundApproval(goal, capability) || risk === "critical",
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
