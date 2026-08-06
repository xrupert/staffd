import type { EvalCaseRecord, EvalRunRecord, EvalSuiteRecord } from "./eval-registry";

export function toStoredSuite(record: EvalSuiteRecord) {
  return {
    suite_id: record.id,
    capability: record.capability,
    capability_version: record.capabilityVersion,
    suite_version: record.suiteVersion,
    definition: record.definition,
    created_by: record.createdBy,
    supersedes_suite_id: record.supersedesSuiteId ?? "",
  };
}

export function toStoredCase(record: EvalCaseRecord) {
  return {
    case_id: record.id,
    suite_id: record.suiteId,
    kind: record.definition.kind,
    definition: record.definition,
  };
}

export function toStoredRun(record: EvalRunRecord) {
  return {
    run_id: record.id,
    suite_id: record.suiteId,
    capability: record.capability,
    capability_version: record.capabilityVersion,
    suite_version: record.suiteVersion,
    baseline_run_id: record.baselineRunId ?? "",
    verdict: record.verdict,
    evidence: record.evidence,
    release_decision: record.releaseDecision,
    started_at: record.startedAt,
    completed_at: record.completedAt,
  };
}
