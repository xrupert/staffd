import type { MissionStatus } from "./mission-control";
import { createPendingMissionEvent, enqueueMissionEvent, type PendingMissionEvent } from "./mission-outbox";

export type MissionTaskSnapshot = {
  id: string;
  status: "pending" | "running" | "succeeded" | "failed" | "retrying";
  input_payload?: { mission_step_id?: string };
  cost_actual_tokens?: number | null;
  error?: string | null;
};

export type MissionExecutionSnapshot = {
  missionId: string;
  currentStatus: MissionStatus;
  pendingEvents?: PendingMissionEvent[];
  tasks: MissionTaskSnapshot[];
};

export type MissionExecutionPatch = {
  status: MissionStatus;
  pending_events: PendingMissionEvent[];
};

function eventKey(missionId: string, stepId: string, suffix: string): string {
  return `${missionId}:${stepId}:${suffix}`;
}

export function reconcileMissionExecution(snapshot: MissionExecutionSnapshot): MissionExecutionPatch {
  let pending = snapshot.pendingEvents ?? [];
  const tasks = snapshot.tasks;
  const hasActive = tasks.some((task) => ["pending", "running", "retrying"].includes(task.status));
  const hasFailed = tasks.some((task) => task.status === "failed");
  const allSucceeded = tasks.length > 0 && tasks.every((task) => task.status === "succeeded");

  for (const task of tasks) {
    const stepId = task.input_payload?.mission_step_id;
    if (!stepId) continue;

    if (task.status === "running") {
      pending = enqueueMissionEvent(pending, createPendingMissionEvent({
        key: eventKey(snapshot.missionId, stepId, "started"),
        type: "step_started",
        stepId,
        message: "Your staff started the next mission step.",
      }));
    }

    if (task.status === "succeeded") {
      pending = enqueueMissionEvent(pending, createPendingMissionEvent({
        key: eventKey(snapshot.missionId, stepId, "completed"),
        type: "step_completed",
        stepId,
        message: "A mission step was completed and verified.",
        costCredits: Math.max(0, Math.ceil((task.cost_actual_tokens ?? 0) / 1000)),
      }));
    }

    if (task.status === "failed") {
      pending = enqueueMissionEvent(pending, createPendingMissionEvent({
        key: eventKey(snapshot.missionId, stepId, "failed"),
        type: "step_escalated",
        stepId,
        message: task.error?.trim() || "A mission step needs attention.",
      }));
    }
  }

  let status: MissionStatus = snapshot.currentStatus;
  if (allSucceeded) status = "completed";
  else if (hasFailed && !hasActive) status = "repairing";
  else if (hasActive) status = "running";

  if (status === "completed") {
    pending = enqueueMissionEvent(pending, createPendingMissionEvent({
      key: `${snapshot.missionId}:completed`,
      type: "mission_completed",
      message: "Your mission is complete and ready for review.",
    }));
  }

  return { status, pending_events: pending };
}
