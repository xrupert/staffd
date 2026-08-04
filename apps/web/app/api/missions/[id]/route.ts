import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import type { MissionRecord } from "../../_lib/orchestrator/mission-repository";

type MissionAction = "approve" | "resume" | "cancel";

const NEXT_STATUS: Record<MissionAction, MissionRecord["status"]> = {
  approve: "planned",
  resume: "planned",
  cancel: "failed",
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: MissionAction };
  try {
    body = (await request.json()) as { action?: MissionAction };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.action || !(body.action in NEXT_STATUS)) {
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

  if (body.action === "approve" && mission.status !== "waiting_for_approval") {
    return Response.json({ error: "mission_not_waiting_for_approval" }, { status: 409 });
  }
  if (body.action === "resume" && !["failed", "repairing"].includes(mission.status)) {
    return Response.json({ error: "mission_not_resumable" }, { status: 409 });
  }

  const response = await fetch(`${pbUrl()}/api/collections/missions/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ status: NEXT_STATUS[body.action] }),
  });
  if (!response.ok) {
    return Response.json({ error: "mission_update_failed" }, { status: 500 });
  }

  const updated = (await response.json()) as MissionRecord;
  return Response.json({ mission: updated });
}
