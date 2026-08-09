import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  pbEscape: (value: string) => value.replaceAll("'", "\\'"),
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKER_SECRET = "worker-secret";
  global.fetch = fetchMock as unknown as typeof fetch;
});

const mission = {
  id: "mission-1",
  user: "owner-1",
  outcome_id: "run_a_campaign",
  goal: "Launch a campaign and improve qualified leads",
  status: "running",
  risk: "medium",
  budget_credits: 20,
  approval_required: false,
  workflow_id: "workflow-1",
  plan: {
    id: "plan-1",
    goal: "Launch a campaign and improve qualified leads",
    requestedBy: "owner-1",
    status: "planned",
    risk: "medium",
    budgetCredits: 20,
    constraints: [],
    successCriteria: ["Campaign is delivered", "Qualified leads improve"],
    steps: [],
    inversionReviewed: true,
    failureModes: [],
  },
  evidence: [],
  correlation_id: "corr-1",
  pending_events: [],
};

describe("mission sync Mission Memory capture", () => {
  it("requires worker authorization", async () => {
    const { GET } = await import("../app/api/worker/mission-sync/route");
    const response = await GET(new Request("http://localhost/api/worker/mission-sync"));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures execution completion as inconclusive and unapproved learning", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [mission] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [
        { id: "task-1", status: "succeeded", input_payload: { mission_step_id: "step-1" } },
        { id: "task-2", status: "succeeded", input_payload: { mission_step_id: "step-2" } },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...mission, status: "completed" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "pb-outcome-1" }) });

    const { GET } = await import("../app/api/worker/mission-sync/route");
    const response = await GET(new Request("http://localhost/api/worker/mission-sync", {
      headers: { "x-worker-secret": "worker-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1, failed: 0 });

    const outcomeCreate = fetchMock.mock.calls[4]!;
    expect(String(outcomeCreate[0])).toContain("mission_outcomes/records");
    const payload = JSON.parse(String((outcomeCreate[1] as RequestInit).body));
    expect(payload).toMatchObject({
      outcome_id: "mission-completion-mission-1",
      user: "owner-1",
      mission_id: "mission-1",
      outcome_status: "inconclusive",
      approved_for_learning: false,
    });
    expect(payload.actual_outcome).toContain("not yet been independently measured");
  });
});
