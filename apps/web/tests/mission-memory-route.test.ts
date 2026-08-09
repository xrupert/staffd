import { beforeEach, describe, expect, it, vi } from "vitest";

const whoAmI = vi.fn();
vi.mock("../app/api/_lib/integrations/identity", () => ({ whoAmI: (...args: unknown[]) => whoAmI(...args) }));
vi.mock("../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  pbEscape: (value: string) => value.replaceAll("'", "\\'"),
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function request(body: unknown) {
  return new Request("http://localhost/api/mission-memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const outcome = {
  missionId: "mission-1",
  hypothesis: "Shorter onboarding improves completion.",
  expectedOutcome: "Completion reaches 70%.",
  actualOutcome: "Completion reached 76%.",
  status: "success" as const,
  metrics: [{ name: "Completion", expected: 70, actual: 76, unit: "%" }],
  evidence: ["analytics:experiment-1"],
  lesson: "Shorter onboarding improved completion for this cohort.",
  confidenceBefore: 0.5,
  confidenceAfter: 0.8,
  observedAt: "2026-08-09T12:00:00Z",
};

describe("Mission Memory API", () => {
  it("requires an authenticated owner", async () => {
    whoAmI.mockResolvedValue(null);
    const { POST } = await import("../app/api/mission-memory/route");
    const response = await POST(request({ outcome }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates owner-scoped outcomes as unapproved learning", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "pb-outcome-1" }) });

    const { POST } = await import("../app/api/mission-memory/route");
    const response = await POST(request({ outcome }));
    expect(response.status).toBe(201);

    const createCall = fetchMock.mock.calls[1]!;
    const payload = JSON.parse(String((createCall[1] as RequestInit).body));
    expect(payload).toMatchObject({
      user: "owner-1",
      mission_id: "mission-1",
      approved_for_learning: false,
      approved_by: null,
      approved_at: null,
    });
  });

  it("treats repeated outcome identity as idempotent", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{
          id: "pb-outcome-1",
          outcome_id: "outcome-fixed",
          user: "owner-1",
          mission_id: "mission-1",
          hypothesis: outcome.hypothesis,
          expected_outcome: outcome.expectedOutcome,
          actual_outcome: outcome.actualOutcome,
          outcome_status: "success",
          metrics: outcome.metrics,
          evidence: outcome.evidence,
          lesson: outcome.lesson,
          confidence_before: 0.5,
          confidence_after: 0.8,
          observed_at: "2026-08-09T12:00:00.000Z",
          approved_for_learning: false,
          approved_by: null,
          approved_at: null,
        }],
      }),
    });

    const { POST } = await import("../app/api/mission-memory/route");
    const response = await POST(request({ outcome: { ...outcome, id: "outcome-fixed" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: false, idempotent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires evidence before an outcome can be approved for learning", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{
          id: "pb-outcome-1",
          outcome_id: "outcome-1",
          user: "owner-1",
          mission_id: "mission-1",
          hypothesis: outcome.hypothesis,
          expected_outcome: outcome.expectedOutcome,
          actual_outcome: outcome.actualOutcome,
          outcome_status: "success",
          metrics: outcome.metrics,
          evidence: [],
          lesson: outcome.lesson,
          confidence_before: 0.5,
          confidence_after: 0.8,
          observed_at: "2026-08-09T12:00:00.000Z",
          approved_for_learning: false,
          approved_by: null,
          approved_at: null,
        }],
      }),
    });

    const { POST } = await import("../app/api/mission-memory/route");
    const response = await POST(request({ action: "approve_learning", outcomeId: "outcome-1" }));
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
