import { describe, expect, it } from "vitest";
import type { EvalRunVerdict, EvalSuite } from "./eval-engineering";
import { compareEvalRuns, createCaseRecord, createRunRecord, createSuiteRecord } from "./eval-registry";

const suite: EvalSuite = {
  id: "research-v1",
  capability: "research_answer",
  capabilityVersion: "1.0.0",
  suiteVersion: "1",
  thresholds: {},
  minimumPassRate: 1,
};

const verdict = (releasable: boolean, score: number): EvalRunVerdict => ({
  releasable,
  passRate: score,
  weightedScore: score,
  dimensionScores: { correctness: score, groundedness: score },
  failures: releasable ? [] : ["blocked"],
});

describe("CSO eval registry", () => {
  it("creates immutable suite and case records with matching identities", () => {
    const suiteRecord = createSuiteRecord({
      id: suite.id,
      capability: suite.capability,
      capabilityVersion: suite.capabilityVersion,
      suiteVersion: suite.suiteVersion,
      definition: suite,
      createdAt: "2026-08-06T12:00:00Z",
      createdBy: "cso",
      supersedesSuiteId: null,
    });
    expect(suiteRecord.createdAt).toBe("2026-08-06T12:00:00.000Z");

    const caseRecord = createCaseRecord({
      id: "golden-1",
      suiteId: suite.id,
      createdAt: "2026-08-06T12:01:00Z",
      definition: {
        id: "golden-1",
        suiteId: suite.id,
        kind: "golden",
        input: { question: "Refund policy?" },
        rubric: { correctness: 1 },
        weight: 1,
        tags: [],
      },
    });
    expect(caseRecord.suiteId).toBe(suite.id);
  });

  it("derives release decisions and normalizes evidence", () => {
    const run = createRunRecord({
      id: "run-1",
      suiteId: suite.id,
      capability: suite.capability,
      capabilityVersion: suite.capabilityVersion,
      suiteVersion: suite.suiteVersion,
      baselineRunId: null,
      verdict: verdict(true, 1),
      evidence: ["case-1", " case-1 ", ""],
      startedAt: "2026-08-06T12:00:00Z",
      completedAt: "2026-08-06T12:00:10Z",
    });
    expect(run.releaseDecision).toBe("approved");
    expect(run.evidence).toEqual(["case-1"]);
  });

  it("detects dimension, score, pass-rate, and release regressions", () => {
    const baseline = createRunRecord({ id: "base", suiteId: suite.id, capability: suite.capability, capabilityVersion: "1.0.0", suiteVersion: "1", baselineRunId: null, verdict: verdict(true, 1), evidence: [], startedAt: "2026-08-06T12:00:00Z", completedAt: "2026-08-06T12:00:01Z" });
    const current = createRunRecord({ id: "current", suiteId: suite.id, capability: suite.capability, capabilityVersion: "1.1.0", suiteVersion: "1", baselineRunId: "base", verdict: verdict(false, 0.8), evidence: [], startedAt: "2026-08-06T13:00:00Z", completedAt: "2026-08-06T13:00:01Z" });
    const drift = compareEvalRuns(current, baseline, 0.05);
    expect(drift.regressed).toBe(true);
    expect(drift.reasons).toEqual(expect.arrayContaining(["correctness regressed", "pass rate regressed", "release verdict regressed"]));
  });

  it("rejects mismatched identities and cross-capability drift", () => {
    expect(() => createSuiteRecord({ id: "wrong", capability: suite.capability, capabilityVersion: suite.capabilityVersion, suiteVersion: suite.suiteVersion, definition: suite, createdAt: "2026-08-06T12:00:00Z", createdBy: "cso", supersedesSuiteId: null })).toThrow("identity");
    expect(() => createRunRecord({ id: "run", suiteId: suite.id, capability: suite.capability, capabilityVersion: "1", suiteVersion: "1", baselineRunId: null, verdict: verdict(true, 1), evidence: [], startedAt: "2026-08-06T13:00:00Z", completedAt: "2026-08-06T12:00:00Z" })).toThrow("precede");
    const a = createRunRecord({ id: "a", suiteId: suite.id, capability: "a", capabilityVersion: "1", suiteVersion: "1", baselineRunId: null, verdict: verdict(true, 1), evidence: [], startedAt: "2026-08-06T12:00:00Z", completedAt: "2026-08-06T12:00:01Z" });
    const b = createRunRecord({ id: "b", suiteId: suite.id, capability: "b", capabilityVersion: "1", suiteVersion: "1", baselineRunId: null, verdict: verdict(true, 1), evidence: [], startedAt: "2026-08-06T12:00:00Z", completedAt: "2026-08-06T12:00:01Z" });
    expect(() => compareEvalRuns(a, b)).toThrow("same capability");
  });

  it("rejects invalid timestamps directly", () => {
    expect(() => createSuiteRecord({
      id: suite.id,
      capability: suite.capability,
      capabilityVersion: suite.capabilityVersion,
      suiteVersion: suite.suiteVersion,
      definition: suite,
      createdAt: "not-a-date",
      createdBy: "cso",
      supersedesSuiteId: null,
    })).toThrow("valid timestamp");
  });

  it("rejects blank required registry identities", () => {
    expect(() => createRunRecord({
      id: "   ",
      suiteId: suite.id,
      capability: suite.capability,
      capabilityVersion: suite.capabilityVersion,
      suiteVersion: suite.suiteVersion,
      baselineRunId: null,
      verdict: verdict(true, 1),
      evidence: [],
      startedAt: "2026-08-06T12:00:00Z",
      completedAt: "2026-08-06T12:00:01Z",
    })).toThrow("Run id is required");
  });
});
