import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { evaluateMissionStartConstitution } from "../../_lib/orchestrator/mission-constitution";
import type { MissionEventType } from "../../_lib/orchestrator/mission-events";
import {
  createPendingMissionEvent,
  enqueueMissionEvent,
} from "../../_lib/orchestrator/mission-outbox";
import type { MissionRecord } from "../../_lib/orchestrator/mission-repository";
import { createWorkflowFromMission } from "../../_lib/orchestrator/mission-workflow-bridge";

type MissionAction = "approve" | "resume" | "start" | "cancel";

const NEXT_STATUS: Record<Exclude<MissionAction, "start">, MissionRecord["status"]> = {
  approve: "planned",
  resume: "planned",
  cancel: "failed",
};

const EVENT_BY_ACTION: Record<Exclude<MissionAction, "start">, { type: MissionEventType; message: string }> = {
  approve: { type: "mission_approved", message: "You approved this mission." },
  resume: { type: "mission_started", message: "Mission resumed safely." },
  cancel: { type: "mission_cancelled", message: "Mission cancelled by the owner." },
};

async function createPocketBaseRecord(
  collection: string,
  body: Record<string, unknown>,
  token: string,
): Promise<{ id: string }> {
  const response = await fetch(`${pbUrl()}/api/collections/${collection}/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${collection} creation failed (${response.status}): ${detail}`);
  }
  return response.json() as Promise<{ id: string }>;
}

async function startMission(mission: MissionRecord, token: string): Promise<Response> {
  if (mission.status !== "planned") {
    return Response.json({ error: "mission_not_ready_to_start" }, { status: 409 });
  }
  if (mission.workflow_id) {
    return Response.json({ error: "mission_already_started", workflowId: mission.workflow_id }, { status: 409 });
  }

  const constitution = evaluateMissionStartConstitution(mission);
  if (!constitution.allowed) {
    return Response.json({
      error: "mission_constitution_blocked",
      violations: constitution.violations,
    }, { status: 409 });
  }

  try {
    const result = await createWorkflowFromMission(
      { missionId: mission.id, userId: mission.user, plan: mission.plan },
      {
        createWorkflow: (body) => createPocketBaseRecord("workflows", body, token),
        createTask: (body) => createPocketBaseRecord("workflow_tasks", body, token),
        failWorkflow: async (workflowId, reason) => {
          await fetch(`${pbUrl()}/api/collections/workflows/records/${encodeURIComponent(workflowId)}`, {
            method: "PATCH",
            headers: adminHeaders(token),
            body: JSON.stringify({ status: "failed", error: reason, completed_at: new Date().toISOString() }),
          });
        },
      },
    );

    const pendingEvents = enqueueMissionEvent(
      mission.pending_events,
      createPendingMissionEvent({
        key: `${mission.id}:workflow-started:${result.workflowId}`,
        type: "mission_started",
        message: "Your staff started working on this mission.",
        evidence: { workflowId: result.workflowId, taskIdsByStep: result.taskIdsByStep },
      }),
    );
    const response = await fetch(`${pbUrl()}/api/collections/missions/records/${encodeURIComponent(mission.id)}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({
        status: "running",
        workflow_id: result.workflowId,
        pending_events: pendingEvents,
      }),
    });
    if (!response.ok) throw new Error(`Mission link update failed (${response.status})`);

    return Response.json({ mission: await response.json(), workflowId: result.workflowId, eventQueued: true });
  } catch (error) {
    const pendingEvents = enqueueMissionEvent(
      mission.pending_events,
      createPendingMissionEvent({
        key: `${mission.id}:materialization-failed:${Date.now()}`,
        type: "step_repairing",
        message: "STAFFD could not safely start this mission. It is ready for repair.",
        evidence: { reason: error instanceof Error ? error.message : "Unknown error" },
      }),
    );
    await fetch(`${pbUrl()}/api/collections/missions/records/${encodeURIComponent(mission.id)}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ status: "repairing", pending_events: pendingEvents }),
    });
    console.error("mission workflow materialization failed:", error);
    return Response.json({ error: "mission_start_failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: MissionAction };
  try {
    body = (await request.json()) as { action?: MissionAction };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.action || !["approve", "resume", "start", "cancel"].includes(body.action)) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }

  const { id } = await context.params;
  const token = await getAdminToken();
  const mission = await pbFirst<MissionRecord>(
    "missions",
    `id = '${pbEscape(id)}' && user = '${pbEscape(user.id)}'`,
    token,
  );
  if (!mission) return Response.json({ error: "not_found" }, { status: 404 });

  if (body.action === "start") return startMission(mission, token);
  if (body.action === "approve" && mission.status !== "waiting_for_approval") {
    return Response.json({ error: "mission_not_waiting_for_approval" }, { status: 409 });
  }
  if (body.action === "resume" && !["failed", "repairing"].includes(mission.status)) {
    return Response.json({ error: "mission_not_resumable" }, { status: 409 });
  }

  const action = body.action;
  const event = EVENT_BY_ACTION[action];
  const pendingEvent = createPendingMissionEvent({
    key: `${mission.id}:${action}:${Date.now()}`,
    type: event.type,
    message: event.message,
  });
  const pendingEvents = enqueueMissionEvent(mission.pending_events, pendingEvent);

  const response = await fetch(`${pbUrl()}/api/collections/missions/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ status: NEXT_STATUS[action], pending_events: pendingEvents }),
  });
  if (!response.ok) return Response.json({ error: "mission_update_failed" }, { status: 500 });

  return Response.json({ mission: await response.json(), eventQueued: true });
}
