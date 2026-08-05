import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import {
  advanceRecurringMission,
  recurringMissionIsDue,
  recurringOccurrenceBody,
  recurringOccurrenceCorrelationId,
} from "../../_lib/orchestrator/mission-recurrence";
import type { MissionRecord } from "../../_lib/orchestrator/mission-repository";

const MISSIONS_PER_TICK = 25;

function authorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const workerHeader = request.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";
  return Boolean(
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (workerSecret && workerHeader === workerSecret),
  );
}

async function occurrenceExists(token: string, correlationId: string): Promise<boolean> {
  const filter = encodeURIComponent(`correlation_id = "${pbEscape(correlationId)}"`);
  const response = await fetch(
    `${pbUrl()}/api/collections/missions/records?filter=${filter}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Occurrence lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: MissionRecord[] };
  return Boolean(payload.items?.length);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const now = new Date();
  const filter = encodeURIComponent(
    `recurrence_enabled = true && next_run_at != "" && next_run_at <= "${now.toISOString()}"`,
  );
  const response = await fetch(
    `${pbUrl()}/api/collections/missions/records?filter=${filter}&sort=next_run_at&perPage=${MISSIONS_PER_TICK}`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) return Response.json({ error: "recurring_mission_query_failed" }, { status: 502 });

  const missions = ((await response.json()) as { items?: MissionRecord[] }).items ?? [];
  let created = 0;
  let advanced = 0;
  let failed = 0;

  for (const mission of missions) {
    if (!recurringMissionIsDue(mission, now)) continue;
    try {
      const correlationId = recurringOccurrenceCorrelationId(mission);
      if (!(await occurrenceExists(token, correlationId))) {
        const createResponse = await fetch(`${pbUrl()}/api/collections/missions/records`, {
          method: "POST",
          headers: adminHeaders(token),
          body: JSON.stringify(recurringOccurrenceBody(mission)),
        });
        if (!createResponse.ok) {
          const alreadyCreated = await occurrenceExists(token, correlationId);
          if (!alreadyCreated) throw new Error(`Occurrence create failed (${createResponse.status})`);
        } else {
          created++;
        }
      }

      const patchResponse = await fetch(
        `${pbUrl()}/api/collections/missions/records/${encodeURIComponent(mission.id)}`,
        {
          method: "PATCH",
          headers: adminHeaders(token),
          body: JSON.stringify(advanceRecurringMission(mission)),
        },
      );
      if (!patchResponse.ok) throw new Error(`Schedule advance failed (${patchResponse.status})`);
      advanced++;
    } catch (error) {
      failed++;
      console.error(`Recurring mission materialization failed mission=${mission.id}:`, error);
    }
  }

  return Response.json({ ok: true, scanned: missions.length, created, advanced, failed });
}
