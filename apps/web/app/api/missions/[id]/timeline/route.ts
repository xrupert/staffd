import { whoAmI } from "../../../_lib/integrations/identity";
import { getAdminToken, pbEscape, pbFirst } from "../../../_lib/pb";
import { listMissionEvents, summarizeMissionTimeline } from "../../../_lib/orchestrator/mission-events";
import type { MissionRecord } from "../../../_lib/orchestrator/mission-repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const token = await getAdminToken();
  const mission = await pbFirst<MissionRecord>(
    "missions",
    `id = '${pbEscape(id)}' && user = '${pbEscape(user.id)}'`,
    token,
  );
  if (!mission) return Response.json({ error: "mission_not_found" }, { status: 404 });

  try {
    const events = await listMissionEvents(user.id, mission.id);
    const timeline = summarizeMissionTimeline(mission.plan.steps.length, mission.status, events);
    return Response.json({ missionId: mission.id, ...timeline });
  } catch (error) {
    console.error("mission timeline failed:", error);
    return Response.json({ error: "timeline_unavailable" }, { status: 503 });
  }
}
