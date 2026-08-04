import { adminHeaders, getAdminToken, pbUrl } from "../pb";
import type { MissionPlan, MissionStatus } from "./mission-control";
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
  plan: MissionPlan;
  evidence: string[];
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

  return deps.createRecord({
    user: input.userId,
    outcome_id: input.outcomeId,
    goal: input.plan.goal,
    status: input.approvalRequired ? "waiting_for_approval" : input.plan.status,
    risk: input.plan.risk,
    budget_credits: input.plan.budgetCredits,
    approval_required: input.approvalRequired,
    plan: input.plan,
    evidence: input.evidence,
    correlation_id: input.correlationId,
  });
}
