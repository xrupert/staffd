import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import {
  recommendExecutiveActions,
  type MissionSignal,
} from "../../_lib/orchestrator/executive-recommendations";
import {
  groupMissionEvents,
  listMissionEventsForUser,
  summarizeMissionTimeline,
} from "../../_lib/orchestrator/mission-events";
import type { MissionRecord } from "../../_lib/orchestrator/mission-repository";

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
      console.error("executive recommendation events unavailable:", eventError);
    }

    const signals: MissionSignal[] = missions.map((mission) => {
      const timeline = summarizeMissionTimeline(
        mission.plan.steps.length,
        mission.status,
        eventsByMission.get(mission.id) ?? [],
      );
      const latestEvent = timeline.events.at(-1);

      return {
        id: mission.id,
        goal: mission.goal,
        status: mission.status,
        updated: mission.updated,
        progress: {
          percent: timeline.progressPercent,
          latestMessage: latestEvent?.message ?? null,
        },
      };
    });

    return Response.json({ recommendations: recommendExecutiveActions(signals).slice(0, 5) });
  } catch (error) {
    console.error("executive recommendations failed:", error);
    return Response.json({ error: "executive_recommendations_failed" }, { status: 500 });
  }
}
