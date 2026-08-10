import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import { whoAmI } from "../_lib/integrations/identity";
import { fromStoredKnowledgeGraphNode, type StoredKnowledgeGraphNode } from "../_lib/orchestrator/business-knowledge-graph-store";
import { invertMissionPlan } from "../_lib/orchestrator/inversion";
import { planMission } from "../_lib/orchestrator/mission-control";
import { buildMissionDeliveryPackage } from "../_lib/orchestrator/mission-delivery";
import {
  groupMissionEvents,
  listMissionEventsForUser,
  summarizeMissionTimeline,
} from "../_lib/orchestrator/mission-events";
import { buildMissionPlanningContext } from "../_lib/orchestrator/mission-planning-context";
import { createMission, type MissionRecord } from "../_lib/orchestrator/mission-repository";
import { outcomeById, type StaffOutcomeId } from "../_lib/orchestrator/outcome-catalog";

function correlationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function planningContextFor(ownerId: string, goal: string) {
  try {
    const token = await getAdminToken();
    const filter = `user = '${pbEscape(ownerId)}'`;
    const response = await fetch(
      `${pbUrl()}/api/collections/business_graph_nodes/records?filter=${encodeURIComponent(filter)}&perPage=200&sort=-confidence`,
      { headers: adminHeaders(token), cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Business graph planning query failed (${response.status})`);
    const payload = (await response.json()) as { items?: StoredKnowledgeGraphNode[] };
    const nodes = (payload.items ?? []).map(fromStoredKnowledgeGraphNode);
    return buildMissionPlanningContext(goal, nodes);
  } catch (error) {
    console.error("mission planning graph context unavailable:", error);
    return buildMissionPlanningContext(goal, [], new Date(), true);
  }
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getAdminToken();
    const params = new URLSearchParams({ filter: `user = '${pbEscape(user.id)}'`, sort: "-updated", perPage: "50" });
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
        const events = eventsByMission.get(mission.id) ?? [];
        const timeline = summarizeMissionTimeline(
          mission.plan.steps.length,
          mission.status,
          events,
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
          delivery: buildMissionDeliveryPackage(mission, events),
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
    const planningContext = await planningContextFor(user.id, goal);
    const invertedPlan = invertMissionPlan(planMission({
      goal,
      requestedBy: user.id,
      successCriteria: outcome.evidence.map((item) => `${item} is present and verified`),
    }));
    const plan = {
      ...invertedPlan,
      constraints: [...new Set([...invertedPlan.constraints, ...planningContext.constraints])],
      planningContext,
    };
    const mission = await createMission({
      userId: user.id,
      outcomeId: outcome.id,
      plan,
      approvalRequired: outcome.requiresApproval,
      evidence: [...new Set([
        ...outcome.evidence,
        ...planningContext.items.flatMap((item) => item.provenance),
      ])],
      correlationId: correlationId(),
    });

    return Response.json({
      missionId: mission.id,
      status: mission.status,
      goal: mission.goal,
      approvalRequired: mission.approval_required,
      plan: mission.plan,
      eventQueued: Boolean(mission.pending_events?.length),
    }, { status: 201 });
  } catch (error) {
    console.error("mission intake failed:", error);
    return Response.json(
      { error: "mission_creation_failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
