import { createMissionOutcome, type MissionOutcomeRecord } from "./mission-memory";
import type { MissionTaskSnapshot } from "./mission-execution-sync";
import type { MissionRecord } from "./mission-repository";

export function missionCompletionObservation(
  mission: MissionRecord,
  tasks: MissionTaskSnapshot[],
  observedAt: string,
): MissionOutcomeRecord {
  const succeeded = tasks.filter((task) => task.status === "succeeded");
  if (!tasks.length || succeeded.length !== tasks.length) {
    throw new Error("Mission completion memory requires all workflow tasks to succeed");
  }

  const evidence = [
    `mission:${mission.id}`,
    ...(mission.workflow_id ? [`workflow:${mission.workflow_id}`] : []),
    ...succeeded.map((task) => `workflow_task:${task.id}`),
  ];

  return createMissionOutcome({
    id: `mission-completion-${mission.id}`,
    ownerId: mission.user,
    missionId: mission.id,
    hypothesis: `Completing the mission plan will advance the requested outcome: ${mission.goal}`,
    expectedOutcome: mission.plan.successCriteria.join("; ") || "The requested business outcome is delivered and verified",
    actualOutcome: "All governed workflow tasks completed successfully. The downstream business outcome has not yet been independently measured.",
    status: "inconclusive",
    metrics: [],
    evidence,
    lesson: "Execution completion is verified, but business impact requires a separate measured outcome before STAFFD may learn from it.",
    confidenceBefore: 0.5,
    confidenceAfter: 0.5,
    observedAt,
  });
}
