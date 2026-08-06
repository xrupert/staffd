import { describe, expect, it } from "vitest";
import type { EvalCaseRecord, EvalRunRecord, EvalSuiteRecord } from "./eval-registry";
import { toStoredCase, toStoredRun, toStoredSuite } from "./eval-store";

const suite: EvalSuiteRecord = {
  id: "suite-1",
  capability: "research_answer",
  capabilityVersion: "1.0.0",
  suiteVersion: "1",
  definition: {
    id: "suite-1",
    capability: "research_answer",
    capabilityVersion: "1.0.0",
    suiteVersion: "1",
    thresholds: {},
    minimumPassRate: 1,
  },
  createdAt: "2026-08-06T12:00:00.000Z",
  createdBy: "cso",
  supersedesSuiteId: null,
};

const testCase: EvalCaseRecord = {
  id: "case-1",
  suiteId: "suite-1",
  createdAt: "2026-08-06T12:01:00.000Z",
  definition: {
    id: "case-1",
    suiteId: "suite-1",
    kind: "golden",
    input: { question: "Refund policy?" },
    rubric: { correctness: 1 },
    weight: 1,
    tags: ["policy"],
  },
};

const run: EvalRunRecord = {
  id: "run-1",
  suiteId: "suite-1",
  capability: "research_answer",
  capabilityVersion: "1.0.0",
  suiteVersion: "1",
  baselineRunId: null,
  verdict: { releasable: true, passRate: 1, weightedScore: 1, dimensionScores: { correctness: 1 }, failures: [] },
  evidence: ["case-1"],
  startedAt: "2026-08-06T12:02:00.000Z",
  completedAt: "2026-08-06T12:02:05.000Z",
  releaseDecision: "approved",
};

describe("eval registry storage mappings", () => {
  it("maps immutable suite identity and optional supersession", () => {
    expect(toStoredSuite(suite)).toMatchObject({
      suite_id: "suite-1",
      capability_version: "1.0.0",
      suite_version: "1",
      created_by: "cso",
      supersedes_suite_id: "",
    });
  });

  it("maps case kind and definition", () => {
    expect(toStoredCase(testCase)).toMatchObject({ case_id: "case-1", suite_id: "suite-1", kind: "golden" });
  });

  it("maps append-only run verdict, evidence, and release decision", () => {
    expect(toStoredRun(run)).toMatchObject({
      run_id: "run-1",
      baseline_run_id: "",
      evidence: ["case-1"],
      release_decision: "approved",
    });
  });
});
