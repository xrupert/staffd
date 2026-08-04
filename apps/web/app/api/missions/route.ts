import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import { whoAmI } from "../_lib/integrations/identity";
import { planMission } from "../_lib/orchestrator/mission-control";
import {
  appendMissionEvent,
  groupMissionEvents,
  listMissionEventsForUser,
  summarizeMissionTimeline,
} from "../_lib/orchestrator/mission-events";
import { createMission, type MissionRecord } from "../_lib/orchestrator/mission-repository";
import { outcomeById, type StaffOutcomeId } from "../_lib/orchestrator/outcome-catalog";

function correlationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getAdminToken();
    const params = new URLSearchParams({
      filter: `user = '${pbEscape(user.id)}'`,
      sort: "-updated",
      perPage: "50",
    });
    const response = await fetch(`${pbUrl()}/api/collections/missions/records?${params}`, {
      headers: adminHeaders(token),
    });
    if (!response.ok) throw new Error(`Mission listing failed (${response.status})`);
    const payload = (await response.json()) as { items?: MissionRecord[] };
    const missions = payload.items ?? [];

    let eventsByMission = new Map();
    try {
      eventsByMission = groupMissionEvents(await listMissionEventsForUser(user.id));
    } catch (eventError) {
      console.error("mission progress events unavailable:", eventError);
    }

    return Response.json({
      missions: missions.map((mission) => {
        const timeline = summarizeMissionTimeline(
          mission.plan.steps.length,
          mission.status,
          eventsByMission.get(mission.id) ?? [],
        );
        const latestEvent = timeline.events.at(-1);
        return {
          ...mission,
          progress: {
            percent: timeline.progressPercent,
            completedSteps: timeline.completedSteps,
            totalSteps: timeline.totalSteps,
            spentCredits: timeline.spentCredits,
            latestMessage: latestEvent?.message ?? null,
            latestAt: latestEvent?.created ?? null,
          },
        };
      }),
    });
  } catch (error) {
    console.error("mission listing failed:", error);
    return Response.json({ error: "mission_listing_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { outcomeId?: StaffOutcomeId; goal?: string };
  try {
    body = (await request.json()) as { outcomeId?: StaffOutcomeId; goal?: string };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.outcomeId) return Response.json({ error: "outcome_id_required" }, { status: 400 });

  try {
    const outcome = outcomeById(body.outcomeId);
    const goal = body.goal?.trim() || outcome.exampleRequest;
    const plan = planMission({
      goal,
      requestedBy: user.id,
      successCriteria: outcome.evidence.map((item) => `${item} is present and verified`),
    });
    const mission = await createMission({
      userId: user.id,
      outcomeId: outcome.id,
      plan,
      approvalRequired: outcome.requiresApproval,
      evidence: outcome.evidence,
      correlationId: correlationId(),
    });

    let eventRecorded = true;
    try {
      await appendMissionEvent({
        user: user.id,
        mission: mission.id,
        type: "mission_created",
        message: mission.approval_required
          ? "Mission created and waiting for your approval."
          : "Mission created and ready for planning.",
        evidence: { outcomeId: outcome.id, requiredEvidence: outcome.evidence },
      });
    } catch (eventError) {
      eventRecorded = false;
      console.error("mission creation event failed:", eventError);
    }

    return Response.json({
      missionId: mission.id,
      status: mission.status,
      goal: mission.goal,
      approvalRequired: mission.approval_required,
      plan: mission.plan,
      eventRecorded,
    }, { status: 201 });
  } catch (error) {
    console.error("mission intake failed:", error);
    return Response.json(
      { error: "mission_creation_failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
