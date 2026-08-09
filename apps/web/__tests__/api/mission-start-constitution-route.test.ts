import { beforeEach, describe, expect, it, vi } from "vitest";

const whoAmI = vi.fn();
const pbFirst = vi.fn();
const createWorkflowFromMission = vi.fn();

vi.mock("../../app/api/_lib/integrations/identity", () => ({
  whoAmI: (...args: unknown[]) => whoAmI(...args),
}));

vi.mock("../../app/api/_lib/pb", () => ({
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
  getAdminToken: vi.fn(async () => "admin-token"),
  pbEscape: (value: string) => value.replaceAll("'", "\\'"),
  pbFirst: (...args: unknown[]) => pbFirst(...args),
  pbUrl: () => "http://pb",
}));

vi.mock("../../app/api/_lib/orchestrator/mission-workflow-bridge", () => ({
  createWorkflowFromMission: (...args: unknown[]) => createWorkflowFromMission(...args),
}));

function mission(inversionReviewed: boolean) {
  return {
    id: "mission-1",
    user: "owner-1",
    outcome_id: "run_a_campaign",
    goal: "Launch a campaign",
    status: "planned",
    risk: "medium",
    budget_credits: 20,
    approval_required: false,
    workflow_id: "",
    plan: {
      id: "plan-1",
      goal: "Launch a campaign",
      requestedBy: "owner-1",
      status: "planned",
      risk: "medium",
      budgetCredits: 20,
      constraints: [],
      successCriteria: ["Delivered"],
      steps: [],
      inversionReviewed,
      failureModes: [],
    },
    evidence: [],
    correlation_id: "corr-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
});

describe("mission start Constitution route gate", () => {
  it("blocks workflow materialization when inversion was never completed", async () => {
    pbFirst.mockResolvedValue(mission(false));
    const { PATCH } = await import("../../app/api/missions/[id]/route");
    const request = new Request("http://localhost/api/missions/mission-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "mission-1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "mission_constitution_blocked",
      violations: expect.arrayContaining([expect.objectContaining({ code: "inversion_required" })]),
    });
    expect(createWorkflowFromMission).not.toHaveBeenCalled();
  });

  it("allows a Constitution-compliant mission to reach the workflow bridge", async () => {
    pbFirst.mockResolvedValue(mission(true));
    createWorkflowFromMission.mockRejectedValue(new Error("stop after gate"));
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => mission(true) })) as unknown as typeof fetch;

    const { PATCH } = await import("../../app/api/missions/[id]/route");
    const request = new Request("http://localhost/api/missions/mission-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: "mission-1" }) });
    expect(createWorkflowFromMission).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
  });
});
