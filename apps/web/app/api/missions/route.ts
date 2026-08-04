import { whoAmI } from "../_lib/integrations/identity";
import { planMission } from "../_lib/orchestrator/mission-control";
import { createMission } from "../_lib/orchestrator/mission-repository";
import { outcomeById, type StaffOutcomeId } from "../_lib/orchestrator/outcome-catalog";

function correlationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

    return Response.json({
      missionId: mission.id,
      status: mission.status,
      goal: mission.goal,
      approvalRequired: mission.approval_required,
      plan: mission.plan,
    }, { status: 201 });
  } catch (error) {
    console.error("mission intake failed:", error);
    return Response.json(
      { error: "mission_creation_failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
