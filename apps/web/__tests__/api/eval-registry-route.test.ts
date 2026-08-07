import { beforeEach, describe, expect, it, vi } from "vitest";
import { governedResearchAnswerCases, governedResearchAnswerSuite } from "../../app/api/_lib/evals/research-answer-benchmark";
import type { ResearchEvalObservation } from "../../app/api/_lib/evals/research-answer-runner";

const fetchMock = vi.fn();

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: vi.fn(async () => "admin-token"),
  adminHeaders: vi.fn((token: string) => ({ Authorization: token, "Content-Type": "application/json" })),
  pbEscape: vi.fn((value: string) => value.replaceAll("'", "\\'")),
  pbUrl: vi.fn(() => "http://pb"),
}));

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.EVAL_REGISTRY_WRITE_TOKEN = "eval-secret";
});

function response(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function request(body: unknown, token = "eval-secret") {
  return new Request("http://localhost/api/evals/registry", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const suite = {
  id: "research-v1",
  capability: "research_answer",
  capabilityVersion: "1.0.0",
  suiteVersion: "1",
  thresholds: {
    correctness: { minimumScore: 0.9, required: true },
    groundedness: { minimumScore: 0.9, required: true },
  },
  minimumPassRate: 1,
};

const testCase = {
  id: "golden-1",
  suiteId: suite.id,
  kind: "golden" as const,
  input: { question: "What is the policy?" },
  rubric: { correctness: 1, groundedness: 1 },
  weight: 1,
  tags: ["policy"],
};

function passingObservation(caseId: string): ResearchEvalObservation {
  return {
    caseId,
    answerCorrect: true,
    citationsPresent: true,
    authoritativeSourceCount: 2,
    independentAuthorityCount: 2,
    disagreementDisclosed: true,
    uncertaintyDisclosed: true,
    staleKnowledgeReverified: true,
    unsupportedClaimBlocked: true,
    sourceInstructionsIgnored: true,
    secretsDisclosed: false,
    humanApprovalRequired: true,
    autonomousHighRiskActionAttempted: false,
    policyConflictDisclosed: true,
    ownerReviewRequired: true,
    historyPreserved: true,
    crossTenantAccessBlocked: true,
    otherTenantExistenceDisclosed: false,
    completed: true,
    businessUseful: true,
    costUsd: 0.02,
    latencyMs: 1_000,
    evidence: [`trace:${caseId}`],
  };
}

describe("CSO eval registry API", () => {
  it("rejects callers without the registry token", async () => {
    const { POST } = await import("../../app/api/evals/registry/route");
    const result = await POST(request({ action: "register_suite", suite }, "wrong"));
    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers a validated suite idempotently", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ id: "pb-suite" }));
    const { POST } = await import("../../app/api/evals/registry/route");
    const result = await POST(request({ action: "register_suite", suite }));
    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ suiteId: suite.id, created: true });
    const createCall = fetchMock.mock.calls[1]!;
    expect(String(createCall[0])).toContain("eval_suites/records");
    expect(JSON.parse(String((createCall[1] as RequestInit).body))).toMatchObject({ suite_id: suite.id, capability: "research_answer" });
  });

  it("refuses case registration when the suite does not exist", async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [] }));
    const { POST } = await import("../../app/api/evals/registry/route");
    const result = await POST(request({ action: "register_case", testCase }));
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "suite_not_found" });
  });

  it("computes and blocks a regressed run instead of trusting the caller", async () => {
    const baseline = {
      run_id: "baseline-1",
      suite_id: suite.id,
      capability: suite.capability,
      capability_version: "0.9.0",
      suite_version: "1",
      baseline_run_id: "",
      verdict: { releasable: true, passRate: 1, weightedScore: 1, dimensionScores: { correctness: 1, groundedness: 1 }, failures: [] },
      evidence: [],
      release_decision: "approved",
      started_at: "2026-08-06T10:00:00Z",
      completed_at: "2026-08-06T10:00:01Z",
    };
    fetchMock
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [{ suite_id: suite.id, definition: suite }] }))
      .mockResolvedValueOnce(response({ items: [{ case_id: testCase.id, suite_id: suite.id, definition: testCase }] }))
      .mockResolvedValueOnce(response({ items: [baseline] }))
      .mockResolvedValueOnce(response({ id: "pb-run" }));

    const { POST } = await import("../../app/api/evals/registry/route");
    const result = await POST(request({
      action: "submit_run",
      runId: "run-2",
      suiteId: suite.id,
      baselineRunId: "baseline-1",
      startedAt: "2026-08-06T11:00:00Z",
      completedAt: "2026-08-06T11:00:01Z",
      results: [{
        caseId: testCase.id,
        scores: { correctness: 0.8, groundedness: 0.8 },
        costUsd: 0.01,
        latencyMs: 100,
        passedAssertions: true,
        evidence: ["result"],
      }],
    }));

    expect(result.status).toBe(409);
    const body = await result.json();
    expect(body.releaseDecision).toBe("blocked");
    expect(body.verdict.releasable).toBe(false);
    expect(body.verdict.failures).toEqual(expect.arrayContaining([
      "correctness score is below the release threshold",
      "groundedness score is below the release threshold",
      "Drift: correctness regressed",
    ]));
  });

  it("scores governed research observations server-side and persists the computed verdict", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ items: [] }))
      .mockResolvedValueOnce(response({ items: [{ suite_id: governedResearchAnswerSuite.id, definition: governedResearchAnswerSuite }] }))
      .mockResolvedValueOnce(response({ items: governedResearchAnswerCases.map((definition) => ({ case_id: definition.id, suite_id: definition.suiteId, definition })) }))
      .mockResolvedValueOnce(response({ id: "pb-research-run" }));

    const { POST } = await import("../../app/api/evals/registry/route");
    const result = await POST(request({
      action: "submit_governed_research_run",
      runId: "research-run-1",
      observations: governedResearchAnswerCases.map((item) => passingObservation(item.id)),
      startedAt: "2026-08-07T12:00:00Z",
      completedAt: "2026-08-07T12:00:05Z",
    }));

    expect(result.status).toBe(201);
    expect(await result.json()).toMatchObject({ runId: "research-run-1", releaseDecision: "approved" });
    const createCall = fetchMock.mock.calls[3]!;
    expect(String(createCall[0])).toContain("eval_runs/records");
    expect(JSON.parse(String((createCall[1] as RequestInit).body))).toMatchObject({ run_id: "research-run-1", release_decision: "approved" });
  });
});
