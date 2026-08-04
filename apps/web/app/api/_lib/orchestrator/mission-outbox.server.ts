import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../pb";
import { appendMissionEvent, type MissionEventRecord } from "./mission-events";
import { removeDeliveredMissionEvents } from "./mission-outbox";
import type { MissionRecord } from "./mission-repository";

export type DrainMissionOutboxResult = {
  scanned: number;
  delivered: number;
  duplicates: number;
  failed: number;
};

async function eventAlreadyDelivered(eventKey: string, token: string): Promise<boolean> {
  const existing = await pbFirst<MissionEventRecord>(
    "mission_events",
    `event_key = '${pbEscape(eventKey)}'`,
    token,
  );
  return Boolean(existing);
}

export async function drainMissionOutbox(limit = 100): Promise<DrainMissionOutboxResult> {
  const token = await getAdminToken();
  const params = new URLSearchParams({ sort: "+updated", perPage: String(Math.min(200, limit)) });
  const response = await fetch(`${pbUrl()}/api/collections/missions/records?${params}`, {
    headers: { Authorization: token },
  });
  if (!response.ok) throw new Error(`Mission outbox scan failed (${response.status})`);

  const payload = (await response.json()) as { items?: MissionRecord[] };
  const missions = (payload.items ?? []).filter((mission) => (mission.pending_events?.length ?? 0) > 0);
  const result: DrainMissionOutboxResult = { scanned: missions.length, delivered: 0, duplicates: 0, failed: 0 };

  for (const mission of missions) {
    const deliveredKeys = new Set<string>();
    for (const pending of mission.pending_events ?? []) {
      try {
        if (await eventAlreadyDelivered(pending.key, token)) {
          deliveredKeys.add(pending.key);
          result.duplicates += 1;
          continue;
        }

        await appendMissionEvent({
          event_key: pending.key,
          user: mission.user,
          mission: mission.id,
          type: pending.type,
          step_id: pending.stepId,
          message: pending.message,
          evidence: pending.evidence,
          cost_credits: pending.costCredits,
        });
        deliveredKeys.add(pending.key);
        result.delivered += 1;
      } catch (error) {
        result.failed += 1;
        console.error("mission outbox delivery failed:", { missionId: mission.id, eventKey: pending.key, error });
      }
    }

    if (deliveredKeys.size === 0) continue;
    const remaining = removeDeliveredMissionEvents(mission.pending_events, deliveredKeys);
    const patch = await fetch(`${pbUrl()}/api/collections/missions/records/${encodeURIComponent(mission.id)}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ pending_events: remaining }),
    });
    if (!patch.ok) {
      result.failed += deliveredKeys.size;
      console.error("mission outbox cleanup failed:", { missionId: mission.id, status: patch.status });
    }
  }

  return result;
}
