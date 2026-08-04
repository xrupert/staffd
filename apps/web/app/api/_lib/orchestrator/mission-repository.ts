import { adminHeaders, getAdminToken, pbUrl } from "../pb";
import type { MissionPlan, MissionStatus } from "./mission-control";
import { createPendingMissionEvent, type PendingMissionEvent } from "./mission-outbox";
import type { StaffOutcomeId } from "./outcome-catalog";

export type MissionRecord = {
  id: string;
  user: string;
  outcome_id: StaffOutcomeId;
  goal: string;
  status: MissionStatus;
  risk: MissionPlan["risk"];
  budget_credits: number;
  approval_required: boolean;
  workflow_id?: string;
  plan: MissionPlan;
  evidence: string[];
  pending_events?: PendingMissionEvent[];
  correlation_id: string;
  created?: string;
  updated?: string;
};

export type CreateMissionInput = {
  userId: string;
  outcomeId: StaffOutcomeId;
  plan: MissionPlan;
  approvalRequired: boolean;
  evidence: string[];
  correlationId: string;
};

export type MissionRepositoryDeps = {
  createRecord: (body: Omit<MissionRecord, "id" | "created" | "updated">) => Promise<MissionRecord>;
};

function defaultDeps(): MissionRepositoryDeps {
  return {
    createRecord: async (body) => {
      const token = await getAdminToken();
      const response = await fetch(`${pbUrl()}/api/collections/missions/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`Mission persistence failed (${response.status}): ${detail}`);
      }
      return response.json() as Promise<MissionRecord>;
    },
  };
}

export async function createMission(
  input: CreateMissionInput,
  deps: MissionRepositoryDeps = defaultDeps(),
): Promise<MissionRecord> {
  if (!input.userId.trim()) throw new Error("Mission owner is required");
  if (!input.correlationId.trim()) throw new Error("Mission correlation ID is required");

  const approvalRequired = input.approvalRequired;
  return deps.createRecord({
    user: input.userId,
    outcome_id: input.outcomeId,
    goal: input.plan.goal,
    status: approvalRequired ? "waiting_for_approval" : input.plan.status,
    risk: input.plan.risk,
    budget_credits: input.plan.budgetCredits,
    approval_required: approvalRequired,
    workflow_id: "",
    plan: input.plan,
    evidence: input.evidence,
    pending_events: [
      createPendingMissionEvent({
        key: `${input.correlationId}:created`,
        type: "mission_created",
        message: approvalRequired
          ? "Mission created and waiting for your approval."
          : "Mission created and ready for planning.",
        evidence: { outcomeId: input.outcomeId, requiredEvidence: input.evidence },
      }),
    ],
    correlation_id: input.correlationId,
  });
}
