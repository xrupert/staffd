import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import type { MissionStatus } from "./mission-control";

export type MissionEventType =
  | "mission_created"
  | "mission_approved"
  | "mission_started"
  | "step_started"
  | "step_completed"
  | "step_repairing"
  | "step_escalated"
  | "evidence_recorded"
  | "mission_completed"
  | "mission_failed"
  | "mission_cancelled";

export type MissionEventRecord = {
  id: string;
  user: string;
  mission: string;
  type: MissionEventType;
  step_id?: string;
  message: string;
  evidence?: Record<string, unknown>;
  cost_credits?: number;
  created?: string;
};

export type MissionTimeline = {
  progressPercent: number;
  completedSteps: number;
  totalSteps: number;
  spentCredits: number;
  latestStatus: MissionStatus;
  events: MissionEventRecord[];
};

export function summarizeMissionTimeline(
  totalSteps: number,
  status: MissionStatus,
  events: readonly MissionEventRecord[],
): MissionTimeline {
  const completedStepIds = new Set(
    events.filter((event) => event.type === "step_completed" && event.step_id).map((event) => event.step_id!),
  );
  const spentCredits = events.reduce((sum, event) => sum + Math.max(0, event.cost_credits ?? 0), 0);
  const terminal = status === "completed"
    ? 100
    : status === "failed"
      ? Math.min(99, totalSteps ? Math.round((completedStepIds.size / totalSteps) * 100) : 0)
      : null;

  return {
    progressPercent: terminal ?? (totalSteps ? Math.round((completedStepIds.size / totalSteps) * 100) : 0),
    completedSteps: completedStepIds.size,
    totalSteps,
    spentCredits,
    latestStatus: status,
    events: [...events],
  };
}

async function fetchMissionEvents(filter: string): Promise<MissionEventRecord[]> {
  const token = await getAdminToken();
  const params = new URLSearchParams({ filter, sort: "+created", perPage: "500" });
  const response = await fetch(`${pbUrl()}/api/collections/mission_events/records?${params}`, {
    headers: { Authorization: token },
  });
  if (!response.ok) throw new Error(`Mission events could not be loaded (${response.status})`);
  const payload = (await response.json()) as { items?: MissionEventRecord[] };
  return payload.items ?? [];
}

export function groupMissionEvents(
  events: readonly MissionEventRecord[],
): Map<string, MissionEventRecord[]> {
  const grouped = new Map<string, MissionEventRecord[]>();
  for (const event of events) {
    const missionEvents = grouped.get(event.mission) ?? [];
    missionEvents.push(event);
    grouped.set(event.mission, missionEvents);
  }
  return grouped;
}

export async function listMissionEvents(userId: string, missionId: string): Promise<MissionEventRecord[]> {
  return fetchMissionEvents(
    `user = '${pbEscape(userId)}' && mission = '${pbEscape(missionId)}'`,
  );
}

export async function listMissionEventsForUser(userId: string): Promise<MissionEventRecord[]> {
  return fetchMissionEvents(`user = '${pbEscape(userId)}'`);
}

export async function appendMissionEvent(
  event: Omit<MissionEventRecord, "id" | "created">,
): Promise<MissionEventRecord> {
  const token = await getAdminToken();
  const response = await fetch(`${pbUrl()}/api/collections/mission_events/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Mission event could not be recorded (${response.status})`);
  return response.json() as Promise<MissionEventRecord>;
}
