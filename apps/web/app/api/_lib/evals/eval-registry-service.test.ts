import { describe, expect, it, vi } from "vitest";
import type { EvalCase, EvalSuite } from "./eval-engineering";
import {
  createEvalRegistryService,
  isEvalRegistryAuthorized,
  storedRunToRecord,
  type EvalRegistryStore,
  type StoredRun,
} from "./eval-registry-service";

const suite: EvalSuite = {
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

const testCase: EvalCase = {
  id: "golden-1",
  suiteId: suite.id,
  kind: "golden",
  input: { question: "Policy?" },
  rubric: { correctness: 1, groundedness: 1 },
  weight: 1,
  tags: [],
};

function store(overrides: Partial<EvalRegistryStore> = {}): EvalRegistryStore {
  return {
    findSuites: vi.fn(async () => []),
    findCasesById: vi.fn(async () => []),
    findCasesBySuite: vi.fn(async () => []),
    findRuns: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "created" })),
    ...overrides,
  };
}

function baseline(): StoredRun {
  return {
    run_id: "base",
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
}

describe("CSO eval registry service", () => {
  it("authenticates only an exact configured bearer token", () => {
    const valid = new Request("http://localhost", { headers: { Authorization: "Bearer secret" } });
    const invalid = new Request("http://localhost", { headers: { Authorization: "Bearer wrong" } });
    expect(isEvalRegistryAuthorized(valid, " secret ")).toBe(true);
    expect(isEvalRegistryAuthorized(invalid, "secret")).toBe(false);
    expect(isEvalRegistryAuthorized(valid, undefined)).toBe(false);
  });

  it("registers immutable suites and treats duplicates idempotently", async () => {
    const backend = store();
    const service = createEvalRegistryService(backend, () => "2026-08-06T12:00:00Z");
    const created = await service.registerSuite(suite);
    expect(created.status).toBe(201);
    expect(backend.create).toHaveBeenCalledWith("eval_suites", expect.objectContaining({ suite_id: suite.id }));

    const duplicateBackend = store({ findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: suite }]) });
    const duplicate = await createEvalRegistryService(duplicateBackend).registerSuite(suite);
    expect(duplicate).toEqual({ status: 200, body: { suiteId: suite.id, created: false, idempotent: true } });
    expect(duplicateBackend.create).not.toHaveBeenCalled();
  });

  it("requires the parent suite and makes cases idempotent", async () => {
    const missing = await createEvalRegistryService(store()).registerCase(testCase);
    expect(missing).toEqual({ status: 404, body: { error: "suite_not_found" } });

    const duplicateBackend = store({
      findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: suite }]),
      findCasesById: vi.fn(async () => [{ case_id: testCase.id, suite_id: suite.id, definition: testCase }]),
    });
    const duplicate = await createEvalRegistryService(duplicateBackend).registerCase(testCase);
    expect(duplicate.status).toBe(200);
    expect(duplicateBackend.create).not.toHaveBeenCalled();
  });

  it("fails closed when a suite has no cases", async () => {
    const backend = store({ findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: suite }]) });
    const result = await createEvalRegistryService(backend).submitRun({
      runId: "run-1",
      suiteId: suite.id,
      results: [],
      startedAt: "2026-08-06T11:00:00Z",
      completedAt: "2026-08-06T11:00:01Z",
    });
    expect(result).toEqual({ status: 409, body: { error: "suite_has_no_cases" } });
  });

  it("blocks threshold failures and baseline regressions", async () => {
    const backend = store({
      findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: suite }]),
      findCasesBySuite: vi.fn(async () => [{ case_id: testCase.id, suite_id: suite.id, definition: testCase }]),
      findRuns: vi.fn(async (id: string) => id === "base" ? [baseline()] : []),
    });
    const result = await createEvalRegistryService(backend).submitRun({
      runId: "run-2",
      suiteId: suite.id,
      baselineRunId: "base",
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
    });
    expect(result.status).toBe(409);
    expect(result.body.releaseDecision).toBe("blocked");
    expect((result.body.verdict as { failures: string[] }).failures).toEqual(expect.arrayContaining([
      "correctness score is below the release threshold",
      "Drift: correctness regressed",
    ]));
    expect(backend.create).toHaveBeenCalledWith("eval_runs", expect.objectContaining({ release_decision: "blocked" }));
  });

  it("normalizes stored baseline records through the canonical run contract", () => {
    const record = storedRunToRecord(baseline());
    expect(record.id).toBe("base");
    expect(record.releaseDecision).toBe("approved");
  });
});
