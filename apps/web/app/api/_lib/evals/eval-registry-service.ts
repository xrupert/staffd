import { evaluateRun, type EvalCase, type EvalCaseResult, type EvalRunVerdict, type EvalSuite } from "./eval-engineering";
import { compareEvalRuns, createCaseRecord, createRunRecord, createSuiteRecord, type EvalRunRecord } from "./eval-registry";
import { toStoredCase, toStoredRun, toStoredSuite } from "./eval-store";

export type StoredSuite = { id?: string; suite_id: string; definition: EvalSuite };
export type StoredCase = { id?: string; case_id: string; suite_id: string; definition: EvalCase };
export type StoredRun = {
  id?: string;
  run_id: string;
  suite_id: string;
  capability: string;
  capability_version: string;
  suite_version: string;
  baseline_run_id?: string;
  verdict: EvalRunVerdict;
  evidence: string[];
  release_decision: "approved" | "blocked";
  started_at: string;
  completed_at: string;
};

export type EvalRegistryStore = {
  findSuites(suiteId: string): Promise<StoredSuite[]>;
  findCasesById(caseId: string): Promise<StoredCase[]>;
  findCasesBySuite(suiteId: string): Promise<StoredCase[]>;
  findRuns(runId: string): Promise<StoredRun[]>;
  create(collection: "eval_suites" | "eval_cases" | "eval_runs", payload: unknown): Promise<unknown>;
};

export type RegistryResult = { status: number; body: Record<string, unknown> };

export function isEvalRegistryAuthorized(request: Request, expectedToken: string | undefined): boolean {
  const expected = expectedToken?.trim();
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export function storedRunToRecord(record: StoredRun): EvalRunRecord {
  return createRunRecord({
    id: record.run_id,
    suiteId: record.suite_id,
    capability: record.capability,
    capabilityVersion: record.capability_version,
    suiteVersion: record.suite_version,
    baselineRunId: record.baseline_run_id || null,
    verdict: record.verdict,
    evidence: record.evidence ?? [],
    startedAt: record.started_at,
    completedAt: record.completed_at,
  });
}

export function createEvalRegistryService(store: EvalRegistryStore, now: () => string = () => new Date().toISOString()) {
  return {
    async registerSuite(suite: EvalSuite, supersedesSuiteId: string | null = null): Promise<RegistryResult> {
      if ((await store.findSuites(suite.id)).length) {
        return { status: 200, body: { suiteId: suite.id, created: false, idempotent: true } };
      }
      const record = createSuiteRecord({
        id: suite.id,
        capability: suite.capability,
        capabilityVersion: suite.capabilityVersion,
        suiteVersion: suite.suiteVersion,
        definition: suite,
        createdAt: now(),
        createdBy: "cso",
        supersedesSuiteId,
      });
      await store.create("eval_suites", toStoredSuite(record));
      return { status: 201, body: { suiteId: record.id, created: true } };
    },

    async registerCase(testCase: EvalCase): Promise<RegistryResult> {
      if (!(await store.findSuites(testCase.suiteId)).length) {
        return { status: 404, body: { error: "suite_not_found" } };
      }
      if ((await store.findCasesById(testCase.id)).length) {
        return { status: 200, body: { caseId: testCase.id, created: false, idempotent: true } };
      }
      const record = createCaseRecord({ id: testCase.id, suiteId: testCase.suiteId, definition: testCase, createdAt: now() });
      await store.create("eval_cases", toStoredCase(record));
      return { status: 201, body: { caseId: record.id, created: true } };
    },

    async submitRun(input: {
      runId: string;
      suiteId: string;
      results: EvalCaseResult[];
      evidence?: string[];
      baselineRunId?: string | null;
      startedAt: string;
      completedAt: string;
      driftTolerance?: number;
    }): Promise<RegistryResult> {
      const duplicate = await store.findRuns(input.runId);
      if (duplicate.length) {
        return { status: 200, body: { runId: input.runId, created: false, idempotent: true, releaseDecision: duplicate[0]!.release_decision } };
      }

      const storedSuite = (await store.findSuites(input.suiteId))[0];
      if (!storedSuite) return { status: 404, body: { error: "suite_not_found" } };
      const cases = await store.findCasesBySuite(input.suiteId);
      if (!cases.length) return { status: 409, body: { error: "suite_has_no_cases" } };

      const verdict = evaluateRun(storedSuite.definition, cases.map((item) => item.definition), input.results);
      let record = createRunRecord({
        id: input.runId,
        suiteId: input.suiteId,
        capability: storedSuite.definition.capability,
        capabilityVersion: storedSuite.definition.capabilityVersion,
        suiteVersion: storedSuite.definition.suiteVersion,
        baselineRunId: input.baselineRunId ?? null,
        verdict,
        evidence: input.evidence ?? [],
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      });

      let drift = null;
      if (input.baselineRunId) {
        const baseline = (await store.findRuns(input.baselineRunId))[0];
        if (!baseline) return { status: 404, body: { error: "baseline_run_not_found" } };
        drift = compareEvalRuns(record, storedRunToRecord(baseline), input.driftTolerance ?? 0);
        if (drift.regressed) {
          record = createRunRecord({
            id: record.id,
            suiteId: record.suiteId,
            capability: record.capability,
            capabilityVersion: record.capabilityVersion,
            suiteVersion: record.suiteVersion,
            baselineRunId: record.baselineRunId,
            evidence: record.evidence,
            startedAt: record.startedAt,
            completedAt: record.completedAt,
            verdict: {
              ...record.verdict,
              releasable: false,
              failures: [...new Set([...record.verdict.failures, ...drift.reasons.map((reason) => `Drift: ${reason}`)])],
            },
          });
        }
      }

      await store.create("eval_runs", toStoredRun(record));
      return {
        status: record.releaseDecision === "approved" ? 201 : 409,
        body: { runId: record.id, created: true, releaseDecision: record.releaseDecision, verdict: record.verdict, drift },
      };
    },
  };
}
