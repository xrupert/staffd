import { describe, expect, it, vi } from "vitest";
import type { EvalCase, EvalSuite } from "./eval-engineering";
import {
  createEvalRegistryService,
  isEvalRegistryAuthorized,
  storedRunToRecord,
  type EvalRegistryStore,
  type StoredRun,
} from "./eval-registry-service";
import { governedResearchAnswerCases, governedResearchAnswerSuite } from "./research-answer-benchmark";
import type { ResearchEvalObservation } from "./research-answer-runner";

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

describe("CSO eval registry service", () => {
  it("authenticates only an exact configured bearer token", () => {
    const valid = new Request("http://localhost", { headers: { Authorization: "Bearer secret" } });
    const invalid = new Request("http://localhost", { headers: { Authorization: "Bearer wrong" } });
    expect(isEvalRegistryAuthorized(valid, " secret ")).toBe(true);
    expect(isEvalRegistryAuthorized(invalid, "secret")).toBe(false);
    expect(isEvalRegistryAuthorized(valid, undefined)).toBe(false);
  });

  it("registers immutable suites, treats exact duplicates idempotently, and rejects identity conflicts", async () => {
    const backend = store();
    const service = createEvalRegistryService(backend, () => "2026-08-06T12:00:00Z");
    const created = await service.registerSuite(suite);
    expect(created.status).toBe(201);
    expect(backend.create).toHaveBeenCalledWith("eval_suites", expect.objectContaining({ suite_id: suite.id }));

    const duplicateBackend = store({ findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: { ...suite, thresholds: { ...suite.thresholds } } }]) });
    const duplicate = await createEvalRegistryService(duplicateBackend).registerSuite(suite);
    expect(duplicate).toEqual({ status: 200, body: { suiteId: suite.id, created: false, idempotent: true } });
    expect(duplicateBackend.create).not.toHaveBeenCalled();

    const conflictBackend = store({ findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: { ...suite, minimumPassRate: 0.5 } }]) });
    const conflict = await createEvalRegistryService(conflictBackend).registerSuite(suite);
    expect(conflict).toEqual({ status: 409, body: { error: "suite_identity_conflict", suiteId: suite.id } });
  });

  it("requires the parent suite, makes exact cases idempotent, and rejects case identity conflicts", async () => {
    const missing = await createEvalRegistryService(store()).registerCase(testCase);
    expect(missing).toEqual({ status: 404, body: { error: "suite_not_found" } });

    const duplicateBackend = store({
      findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: suite }]),
      findCasesById: vi.fn(async () => [{ case_id: testCase.id, suite_id: suite.id, definition: { ...testCase, tags: [] } }]),
    });
    const duplicate = await createEvalRegistryService(duplicateBackend).registerCase(testCase);
    expect(duplicate.status).toBe(200);
    expect(duplicateBackend.create).not.toHaveBeenCalled();

    const conflictBackend = store({
      findSuites: vi.fn(async () => [{ suite_id: suite.id, definition: suite }]),
      findCasesById: vi.fn(async () => [{ case_id: testCase.id, suite_id: suite.id, definition: { ...testCase, weight: 2 } }]),
    });
    const conflict = await createEvalRegistryService(conflictBackend).registerCase(testCase);
    expect(conflict).toEqual({ status: 409, body: { error: "case_identity_conflict", caseId: testCase.id } });
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

  it("seeds the canonical governed research suite and all benchmark cases", async () => {
    let suiteExists = false;
    const caseIds = new Set<string>();
    const backend = store({
      findSuites: vi.fn(async (id: string) => suiteExists && id === governedResearchAnswerSuite.id
        ? [{ suite_id: id, definition: governedResearchAnswerSuite }]
        : []),
      findCasesById: vi.fn(async (id: string) => caseIds.has(id)
        ? [{ case_id: id, suite_id: governedResearchAnswerSuite.id, definition: governedResearchAnswerCases.find((item) => item.id === id)! }]
        : []),
      create: vi.fn(async (collection: string, payload: unknown) => {
        if (collection === "eval_suites") suiteExists = true;
        if (collection === "eval_cases") caseIds.add((payload as { case_id: string }).case_id);
        return { id: "created" };
      }),
    });
    const result = await createEvalRegistryService(backend).seedGovernedResearchBenchmark();
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ suiteId: governedResearchAnswerSuite.id, caseCount: governedResearchAnswerCases.length, createdCases: governedResearchAnswerCases.length });
  });

  it("computes governed research scores server-side before persisting the release decision", async () => {
    const backend = store({
      findSuites: vi.fn(async () => [{ suite_id: governedResearchAnswerSuite.id, definition: governedResearchAnswerSuite }]),
      findCasesBySuite: vi.fn(async () => governedResearchAnswerCases.map((definition) => ({ case_id: definition.id, suite_id: definition.suiteId, definition }))),
    });
    const observations = governedResearchAnswerCases.map((item) => passingObservation(item.id));
    const result = await createEvalRegistryService(backend).submitGovernedResearchRun({
      runId: "research-run-1",
      observations,
      startedAt: "2026-08-07T12:00:00Z",
      completedAt: "2026-08-07T12:00:05Z",
    });
    expect(result.status).toBe(201);
    expect(result.body.releaseDecision).toBe("approved");
    expect(backend.create).toHaveBeenCalledWith("eval_runs", expect.objectContaining({ run_id: "research-run-1", release_decision: "approved" }));
  });

  it("normalizes stored baseline records through the canonical run contract", () => {
    const record = storedRunToRecord(baseline());
    expect(record.id).toBe("base");
    expect(record.releaseDecision).toBe("approved");
  });
});
