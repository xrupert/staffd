import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { missionCompletionObservation } from "../../_lib/orchestrator/mission-completion-memory";
import { reconcileMissionExecution, type MissionTaskSnapshot } from "../../_lib/orchestrator/mission-execution-sync";
import { toStoredMissionOutcome } from "../../_lib/orchestrator/mission-memory-store";
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

async function persistCompletionMemory(
  mission: MissionRecord,
  tasks: MissionTaskSnapshot[],
  token: string,
): Promise<void> {
  const observation = missionCompletionObservation(mission, tasks, new Date().toISOString());
  const filter = encodeURIComponent(
    `outcome_id = '${pbEscape(observation.id)}' && user = '${pbEscape(mission.user)}'`,
  );
  const lookup = await fetch(
    `${pbUrl()}/api/collections/mission_outcomes/records?filter=${filter}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!lookup.ok) throw new Error(`mission outcome lookup failed (${lookup.status})`);
  const existing = (await lookup.json()) as { items?: unknown[] };
  if ((existing.items?.length ?? 0) > 0) return;

  const response = await fetch(`${pbUrl()}/api/collections/mission_outcomes/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(toStoredMissionOutcome(observation)),
  });
  if (!response.ok) throw new Error(`mission outcome creation failed (${response.status})`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const pb = pbUrl();
  const filter = encodeURIComponent(
    'workflow_id != "" && (status = "planned" || status = "running" || status = "repairing")',
  );
  const missionResponse = await fetch(
    `${pb}/api/collections/missions/records?filter=${filter}&sort=updated&perPage=${MISSIONS_PER_TICK}`,
    { headers: { Authorization: token } },
  );
  if (!missionResponse.ok) {
    return Response.json({ error: "mission_sync_query_failed" }, { status: 502 });
  }

  const missions = ((await missionResponse.json()) as { items?: MissionRecord[] }).items ?? [];
  let updated = 0;
  let failed = 0;

  for (const mission of missions) {
    try {
      const taskFilter = encodeURIComponent(`workflow_id = "${pbEscape(mission.workflow_id ?? "")}"`);
      const taskResponse = await fetch(
        `${pb}/api/collections/workflow_tasks/records?filter=${taskFilter}&sort=created&perPage=200`,
        { headers: { Authorization: token } },
      );
      if (!taskResponse.ok) throw new Error(`task query failed (${taskResponse.status})`);

      const tasks = ((await taskResponse.json()) as { items?: MissionTaskSnapshot[] }).items ?? [];
      const patch = reconcileMissionExecution({
        missionId: mission.id,
        currentStatus: mission.status,
        pendingEvents: mission.pending_events,
        tasks,
      });

      const changed =
        patch.status !== mission.status ||
        JSON.stringify(patch.pending_events) !== JSON.stringify(mission.pending_events ?? []);
      if (!changed) continue;

      const response = await fetch(`${pb}/api/collections/missions/records/${encodeURIComponent(mission.id)}`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(`mission patch failed (${response.status})`);

      if (patch.status === "completed" && mission.status !== "completed") {
        await persistCompletionMemory(mission, tasks, token);
      }
      updated++;
    } catch (error) {
      failed++;
      console.error(`mission execution sync failed mission=${mission.id}:`, error);
    }
  }

  return Response.json({ ok: true, scanned: missions.length, updated, failed });
}
