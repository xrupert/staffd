import {
  harnessPolicyFor,
  nextLoopDecision,
  type HarnessPolicy,
  type MissionCapability,
  type MissionPlan,
  type MissionStep,
  type StepAttempt,
} from "./mission-control";

export type MissionStepResult = {
  output: string;
  passed: boolean;
  failureFingerprint?: string;
};

export type MissionExecutionContext = {
  missionId: string;
  customerId: string;
  correlationId: string;
};

export type MissionCapabilityHandler = (
  step: MissionStep,
  policy: HarnessPolicy,
  context: MissionExecutionContext,
  priorAttempts: StepAttempt[],
) => Promise<MissionStepResult>;

export type MissionCapabilityRegistry = Partial<
  Record<MissionCapability, MissionCapabilityHandler>
>;

export type MissionExecutionEvent =
  | { type: "step_started"; stepId: string; attempt: number }
  | { type: "step_completed"; stepId: string; attempt: number }
  | { type: "step_repairing"; stepId: string; nextAttempt: number }
  | { type: "step_escalated"; stepId: string; reason: string };

export type MissionExecutionReport = {
  completedStepIds: string[];
  escalatedStepIds: string[];
  attemptsByStep: Record<string, StepAttempt[]>;
  events: MissionExecutionEvent[];
};

function readySteps(plan: MissionPlan, completed: Set<string>): MissionStep[] {
  return plan.steps.filter(
    (step) =>
      !completed.has(step.id) && step.dependsOn.every((dependency) => completed.has(dependency)),
  );
}

export async function executeMission(
  plan: MissionPlan,
  registry: MissionCapabilityRegistry,
  context: MissionExecutionContext,
): Promise<MissionExecutionReport> {
  const completed = new Set<string>();
  const escalated = new Set<string>();
  const attemptsByStep: Record<string, StepAttempt[]> = {};
  const events: MissionExecutionEvent[] = [];

  while (completed.size + escalated.size < plan.steps.length) {
    const runnable = readySteps(plan, completed).filter((step) => !escalated.has(step.id));
    if (runnable.length === 0) break;

    for (const step of runnable) {
      const handler = registry[step.capability];
      if (!handler) {
        escalated.add(step.id);
        events.push({ type: "step_escalated", stepId: step.id, reason: "missing_handler" });
        continue;
      }

      const policy = harnessPolicyFor(step, plan);
      const attempts = (attemptsByStep[step.id] ??= []);

      while (true) {
        const attemptNumber = attempts.length + 1;
        events.push({ type: "step_started", stepId: step.id, attempt: attemptNumber });
        const result = await handler(step, policy, context, attempts);
        attempts.push({ attempt: attemptNumber, ...result });

        const decision = nextLoopDecision(attempts, policy);
        if (decision.action === "complete") {
          completed.add(step.id);
          events.push({ type: "step_completed", stepId: step.id, attempt: attemptNumber });
          break;
        }
        if (decision.action === "escalate") {
          escalated.add(step.id);
          events.push({ type: "step_escalated", stepId: step.id, reason: decision.reason });
          break;
        }

        events.push({
          type: "step_repairing",
          stepId: step.id,
          nextAttempt: decision.nextAttempt,
        });
      }
    }
  }

  return {
    completedStepIds: [...completed],
    escalatedStepIds: [...escalated],
    attemptsByStep,
    events,
  };
}
