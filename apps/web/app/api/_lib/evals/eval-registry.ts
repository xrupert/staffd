import type { EvalCase, EvalRunVerdict, EvalSuite } from "./eval-engineering";

export type EvalSuiteRecord = {
  id: string;
  capability: string;
  capabilityVersion: string;
  suiteVersion: string;
  definition: EvalSuite;
  createdAt: string;
  createdBy: string;
  supersedesSuiteId: string | null;
};

export type EvalCaseRecord = {
  id: string;
  suiteId: string;
  definition: EvalCase;
  createdAt: string;
};

export type EvalRunRecord = {
  id: string;
  suiteId: string;
  capability: string;
  capabilityVersion: string;
  suiteVersion: string;
  baselineRunId: string | null;
  verdict: EvalRunVerdict;
  evidence: string[];
  startedAt: string;
  completedAt: string;
  releaseDecision: "approved" | "blocked";
};

export type EvalDrift = {
  passRateDelta: number;
  weightedScoreDelta: number;
  dimensionDeltas: Record<string, number>;
  regressed: boolean;
  reasons: string[];
};

function iso(value: string, label: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid timestamp`);
  return new Date(timestamp).toISOString();
}

function required(value: string, label: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

export function createSuiteRecord(input: Omit<EvalSuiteRecord, "createdAt"> & { createdAt: string }): EvalSuiteRecord {
  if (input.id !== input.definition.id) throw new Error("Suite record identity must match its definition");
  if (input.capability !== input.definition.capability) throw new Error("Suite capability must match its definition");
  if (input.capabilityVersion !== input.definition.capabilityVersion) throw new Error("Capability version must match its definition");
  if (input.suiteVersion !== input.definition.suiteVersion) throw new Error("Suite version must match its definition");
  return {
    ...input,
    id: required(input.id, "Suite id"),
    createdBy: required(input.createdBy, "Suite creator"),
    createdAt: iso(input.createdAt, "Suite creation time"),
  };
}

export function createCaseRecord(input: EvalCaseRecord): EvalCaseRecord {
  if (input.id !== input.definition.id) throw new Error("Case record identity must match its definition");
  if (input.suiteId !== input.definition.suiteId) throw new Error("Case suite must match its definition");
  return { ...input, id: required(input.id, "Case id"), suiteId: required(input.suiteId, "Case suite"), createdAt: iso(input.createdAt, "Case creation time") };
}

export function createRunRecord(input: Omit<EvalRunRecord, "releaseDecision">): EvalRunRecord {
  const startedAt = iso(input.startedAt, "Run start time");
  const completedAt = iso(input.completedAt, "Run completion time");
  if (new Date(completedAt).getTime() < new Date(startedAt).getTime()) throw new Error("Run completion cannot precede its start");
  return {
    ...input,
    id: required(input.id, "Run id"),
    suiteId: required(input.suiteId, "Run suite"),
    capability: required(input.capability, "Run capability"),
    capabilityVersion: required(input.capabilityVersion, "Run capability version"),
    suiteVersion: required(input.suiteVersion, "Run suite version"),
    startedAt,
    completedAt,
    evidence: [...new Set(input.evidence.map((item) => item.trim()).filter(Boolean))],
    releaseDecision: input.verdict.releasable ? "approved" : "blocked",
  };
}

export function compareEvalRuns(current: EvalRunRecord, baseline: EvalRunRecord, tolerance = 0): EvalDrift {
  if (current.capability !== baseline.capability) throw new Error("Eval drift requires the same capability");
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Drift tolerance must be non-negative");
  const passRateDelta = current.verdict.passRate - baseline.verdict.passRate;
  const weightedScoreDelta = current.verdict.weightedScore - baseline.verdict.weightedScore;
  const dimensions = new Set([
    ...Object.keys(current.verdict.dimensionScores),
    ...Object.keys(baseline.verdict.dimensionScores),
  ]);
  const dimensionDeltas: Record<string, number> = {};
  const reasons: string[] = [];
  for (const dimension of dimensions) {
    const currentScore = current.verdict.dimensionScores[dimension as keyof typeof current.verdict.dimensionScores] ?? 0;
    const baselineScore = baseline.verdict.dimensionScores[dimension as keyof typeof baseline.verdict.dimensionScores] ?? 0;
    const delta = currentScore - baselineScore;
    dimensionDeltas[dimension] = delta;
    if (delta < -tolerance) reasons.push(`${dimension} regressed`);
  }
  if (passRateDelta < -tolerance) reasons.push("pass rate regressed");
  if (weightedScoreDelta < -tolerance) reasons.push("weighted score regressed");
  if (baseline.verdict.releasable && !current.verdict.releasable) reasons.push("release verdict regressed");
  return { passRateDelta, weightedScoreDelta, dimensionDeltas, regressed: reasons.length > 0, reasons };
}
