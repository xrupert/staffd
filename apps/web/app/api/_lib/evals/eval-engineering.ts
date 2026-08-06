export const EVAL_DIMENSIONS = [
  "correctness",
  "groundedness",
  "safety",
  "completion",
  "business_value",
  "tenant_isolation",
  "cost",
  "latency",
] as const;

export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];
export type EvalCaseKind = "golden" | "adversarial" | "regression" | "production_replay";

export type EvalThreshold = {
  minimumScore: number;
  required: boolean;
};

export type EvalSuite = {
  id: string;
  capability: string;
  capabilityVersion: string;
  suiteVersion: string;
  thresholds: Partial<Record<EvalDimension, EvalThreshold>>;
  maximumCostUsd?: number | null;
  maximumLatencyMs?: number | null;
  minimumPassRate: number;
};

export type EvalCase = {
  id: string;
  suiteId: string;
  kind: EvalCaseKind;
  input: unknown;
  expected?: unknown;
  rubric: Partial<Record<EvalDimension, number>>;
  weight: number;
  tags: string[];
};

export type EvalCaseResult = {
  caseId: string;
  scores: Partial<Record<EvalDimension, number>>;
  costUsd: number;
  latencyMs: number;
  passedAssertions: boolean;
  evidence: string[];
};

export type EvalRunVerdict = {
  releasable: boolean;
  passRate: number;
  weightedScore: number;
  dimensionScores: Partial<Record<EvalDimension, number>>;
  failures: string[];
};

const DIMENSION_SET = new Set<string>(EVAL_DIMENSIONS);

function boundedScore(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return value;
}

export function validateEvalSuite(suite: EvalSuite): void {
  if (!suite.id.trim() || !suite.capability.trim() || !suite.capabilityVersion.trim() || !suite.suiteVersion.trim()) {
    throw new Error("Evaluation suite identity is incomplete");
  }
  boundedScore(suite.minimumPassRate, "Minimum pass rate");
  if (suite.maximumCostUsd != null && (!Number.isFinite(suite.maximumCostUsd) || suite.maximumCostUsd < 0)) {
    throw new Error("Maximum cost must be non-negative");
  }
  if (suite.maximumLatencyMs != null && (!Number.isFinite(suite.maximumLatencyMs) || suite.maximumLatencyMs < 0)) {
    throw new Error("Maximum latency must be non-negative");
  }
  for (const [dimension, threshold] of Object.entries(suite.thresholds)) {
    if (!DIMENSION_SET.has(dimension)) throw new Error(`Unknown evaluation dimension: ${dimension}`);
    if (threshold) boundedScore(threshold.minimumScore, `${dimension} threshold`);
  }
}

export function validateEvalCase(testCase: EvalCase): void {
  if (!testCase.id.trim() || !testCase.suiteId.trim()) throw new Error("Evaluation case identity is incomplete");
  if (!Number.isFinite(testCase.weight) || testCase.weight <= 0) throw new Error("Evaluation case weight must be positive");
  if (Object.keys(testCase.rubric).length === 0) throw new Error("Evaluation case requires a rubric");
  for (const [dimension, weight] of Object.entries(testCase.rubric)) {
    if (!DIMENSION_SET.has(dimension)) throw new Error(`Unknown evaluation dimension: ${dimension}`);
    if (!Number.isFinite(weight) || weight <= 0) throw new Error(`${dimension} rubric weight must be positive`);
  }
}

export function evaluateRun(
  suite: EvalSuite,
  cases: EvalCase[],
  results: EvalCaseResult[],
): EvalRunVerdict {
  validateEvalSuite(suite);
  if (cases.length === 0) throw new Error("Evaluation run requires cases");
  cases.forEach(validateEvalCase);

  const resultByCase = new Map(results.map((result) => [result.caseId, result]));
  const failures: string[] = [];
  const dimensionTotals = new Map<EvalDimension, { score: number; weight: number }>();
  let passedWeight = 0;
  let totalWeight = 0;
  let weightedScoreTotal = 0;

  for (const testCase of cases) {
    const result = resultByCase.get(testCase.id);
    totalWeight += testCase.weight;
    if (!result) {
      failures.push(`Missing result for ${testCase.id}`);
      continue;
    }
    if (result.costUsd < 0 || result.latencyMs < 0) throw new Error(`Invalid runtime metrics for ${testCase.id}`);

    let rubricWeight = 0;
    let rubricScore = 0;
    for (const [dimensionKey, weight] of Object.entries(testCase.rubric)) {
      const dimension = dimensionKey as EvalDimension;
      const score = result.scores[dimension];
      if (score == null) {
        failures.push(`${testCase.id} missing ${dimension} score`);
        continue;
      }
      boundedScore(score, `${testCase.id} ${dimension}`);
      rubricWeight += weight;
      rubricScore += score * weight;
      const total = dimensionTotals.get(dimension) ?? { score: 0, weight: 0 };
      total.score += score * testCase.weight * weight;
      total.weight += testCase.weight * weight;
      dimensionTotals.set(dimension, total);
    }

    const caseScore = rubricWeight > 0 ? rubricScore / rubricWeight : 0;
    weightedScoreTotal += caseScore * testCase.weight;
    const withinCost = suite.maximumCostUsd == null || result.costUsd <= suite.maximumCostUsd;
    const withinLatency = suite.maximumLatencyMs == null || result.latencyMs <= suite.maximumLatencyMs;
    const casePassed = result.passedAssertions && withinCost && withinLatency;
    if (casePassed) passedWeight += testCase.weight;
    if (!withinCost) failures.push(`${testCase.id} exceeded cost budget`);
    if (!withinLatency) failures.push(`${testCase.id} exceeded latency budget`);
    if (!result.passedAssertions) failures.push(`${testCase.id} failed deterministic assertions`);
  }

  const passRate = totalWeight > 0 ? passedWeight / totalWeight : 0;
  const weightedScore = totalWeight > 0 ? weightedScoreTotal / totalWeight : 0;
  const dimensionScores: Partial<Record<EvalDimension, number>> = {};
  for (const [dimension, total] of dimensionTotals.entries()) {
    dimensionScores[dimension] = total.weight > 0 ? total.score / total.weight : 0;
  }

  if (passRate < suite.minimumPassRate) failures.push("Evaluation pass rate is below the release threshold");
  for (const [dimensionKey, threshold] of Object.entries(suite.thresholds)) {
    if (!threshold?.required) continue;
    const dimension = dimensionKey as EvalDimension;
    const score = dimensionScores[dimension];
    if (score == null) failures.push(`Required ${dimension} score is missing`);
    else if (score < threshold.minimumScore) failures.push(`${dimension} score is below the release threshold`);
  }

  return {
    releasable: failures.length === 0,
    passRate,
    weightedScore,
    dimensionScores,
    failures,
  };
}
