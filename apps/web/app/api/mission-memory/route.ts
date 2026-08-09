import { whoAmI } from "../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import { approveMissionOutcomeForLearning, createMissionOutcome, type CreateMissionOutcomeInput, type MissionOutcomeRecord } from "../_lib/orchestrator/mission-memory";
import { fromStoredMissionOutcome, toStoredMissionOutcome, type StoredMissionOutcome } from "../_lib/orchestrator/mission-memory-store";

type CreateBody = { action?: "create"; outcome?: Omit<CreateMissionOutcomeInput, "ownerId"> };
type ApproveBody = { action: "approve_learning"; outcomeId?: string };
type RequestBody = CreateBody | ApproveBody;

async function findOutcome(outcomeId: string, ownerId: string, token: string): Promise<(StoredMissionOutcome & { id: string }) | null> {
  const filter = `outcome_id = '${pbEscape(outcomeId)}' && user = '${pbEscape(ownerId)}'`;
  const response = await fetch(`${pbUrl()}/api/collections/mission_outcomes/records?filter=${encodeURIComponent(filter)}&perPage=1`, {
    headers: { Authorization: token },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mission outcome lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: Array<StoredMissionOutcome & { id: string }> };
  return payload.items?.[0] ?? null;
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();

    if (body.action === "approve_learning") {
      const outcomeId = body.outcomeId?.trim() ?? "";
      if (!outcomeId) return Response.json({ error: "outcome_id_required" }, { status: 400 });
      const stored = await findOutcome(outcomeId, user.id, token);
      if (!stored) return Response.json({ error: "not_found" }, { status: 404 });
      const approved = approveMissionOutcomeForLearning(fromStoredMissionOutcome(stored), user.id, new Date().toISOString());
      const response = await fetch(`${pbUrl()}/api/collections/mission_outcomes/records/${encodeURIComponent(stored.id)}`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify(toStoredMissionOutcome(approved)),
      });
      if (!response.ok) throw new Error(`Mission outcome learning approval failed (${response.status})`);
      return Response.json({ outcome: approved });
    }

    if (!body.outcome) return Response.json({ error: "outcome_required" }, { status: 400 });
    const outcome = createMissionOutcome({ ...body.outcome, ownerId: user.id });
    const existing = await findOutcome(outcome.id, user.id, token);
    if (existing) return Response.json({ outcome: fromStoredMissionOutcome(existing), created: false, idempotent: true });

    const response = await fetch(`${pbUrl()}/api/collections/mission_outcomes/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(toStoredMissionOutcome(outcome)),
    });
    if (!response.ok) throw new Error(`Mission outcome creation failed (${response.status})`);
    return Response.json({ outcome, created: true }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown mission memory error";
    const invalid = /required|between 0 and 1|timestamp|finite|Inconclusive|require evidence/i.test(detail);
    return Response.json({ error: invalid ? "invalid_mission_outcome" : "mission_memory_failed", detail }, { status: invalid ? 400 : 503 });
  }
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const token = await getAdminToken();
    const filter = `user = '${pbEscape(user.id)}'`;
    const response = await fetch(`${pbUrl()}/api/collections/mission_outcomes/records?filter=${encodeURIComponent(filter)}&sort=-observed_at&perPage=100`, {
      headers: { Authorization: token },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Mission memory list failed (${response.status})`);
    const payload = (await response.json()) as { items?: StoredMissionOutcome[] };
    return Response.json({ outcomes: (payload.items ?? []).map(fromStoredMissionOutcome) });
  } catch (error) {
    return Response.json({ error: "mission_memory_failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503 });
  }
}
