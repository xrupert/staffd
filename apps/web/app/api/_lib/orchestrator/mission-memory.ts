export type MissionOutcomeStatus = "success" | "partial" | "failure" | "inconclusive";

export type OutcomeMetric = {
  name: string;
  expected?: number | null;
  actual?: number | null;
  unit?: string | null;
};

export type MissionOutcomeRecord = {
  id: string;
  ownerId: string;
  missionId: string;
  hypothesis: string;
  expectedOutcome: string;
  actualOutcome: string;
  status: MissionOutcomeStatus;
  metrics: OutcomeMetric[];
  evidence: string[];
  lesson: string;
  confidenceBefore: number;
  confidenceAfter: number;
  observedAt: string;
  approvedForLearning: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
};

export type CreateMissionOutcomeInput = Omit<
  MissionOutcomeRecord,
  "id" | "evidence" | "approvedForLearning" | "approvedBy" | "approvedAt"
> & {
  id?: string;
  evidence?: string[];
};

const OUTCOME_STATUSES = new Set<MissionOutcomeStatus>(["success", "partial", "failure", "inconclusive"]);

function clean(value: string, label: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized.slice(0, maxLength);
}

function confidence(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
  return value;
}

function stableId(ownerId: string, missionId: string, observedAt: string): string {
  let hash = 2166136261;
  for (const character of `${ownerId}:${missionId}:${observedAt}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `outcome-${(hash >>> 0).toString(36)}`;
}

export function createMissionOutcome(input: CreateMissionOutcomeInput): MissionOutcomeRecord {
  const ownerId = clean(input.ownerId, "Mission outcome owner", 200);
  const missionId = clean(input.missionId, "Mission outcome mission", 200);
  if (!OUTCOME_STATUSES.has(input.status)) throw new Error("Mission outcome status is invalid");
  const observed = new Date(input.observedAt);
  if (!Number.isFinite(observed.getTime())) throw new Error("Mission outcome observation timestamp is invalid");

  const metrics = input.metrics.map((metric) => {
    const name = clean(metric.name, "Outcome metric name", 160);
    if (metric.expected != null && !Number.isFinite(metric.expected)) throw new Error(`${name} expected metric must be finite`);
    if (metric.actual != null && !Number.isFinite(metric.actual)) throw new Error(`${name} actual metric must be finite`);
    return {
      name,
      expected: metric.expected ?? null,
      actual: metric.actual ?? null,
      unit: metric.unit?.replace(/\s+/g, " ").trim().slice(0, 80) || null,
    };
  });

  return {
    id: input.id?.trim() || stableId(ownerId, missionId, observed.toISOString()),
    ownerId,
    missionId,
    hypothesis: clean(input.hypothesis, "Mission hypothesis", 2_000),
    expectedOutcome: clean(input.expectedOutcome, "Expected outcome", 2_000),
    actualOutcome: clean(input.actualOutcome, "Actual outcome", 2_000),
    status: input.status,
    metrics,
    evidence: [...new Set((input.evidence ?? []).map((item) => item.trim()).filter(Boolean))],
    lesson: clean(input.lesson, "Mission lesson", 2_000),
    confidenceBefore: confidence(input.confidenceBefore, "Confidence before"),
    confidenceAfter: confidence(input.confidenceAfter, "Confidence after"),
    observedAt: observed.toISOString(),
    approvedForLearning: false,
    approvedBy: null,
    approvedAt: null,
  };
}

export function missionOutcomeDelta(record: MissionOutcomeRecord): Record<string, number | null> {
  return Object.fromEntries(record.metrics.map((metric) => [
    metric.name,
    metric.expected == null || metric.actual == null ? null : metric.actual - metric.expected,
  ]));
}

export function approveMissionOutcomeForLearning(
  record: MissionOutcomeRecord,
  approverId: string,
  approvedAt: string,
): MissionOutcomeRecord {
  const approver = clean(approverId, "Learning approver", 200);
  const timestamp = new Date(approvedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Learning approval timestamp is invalid");
  if (record.ownerId !== approver) throw new Error("Only the mission outcome owner may approve learning");
  if (record.status === "inconclusive") throw new Error("Inconclusive outcomes cannot become approved learning");
  if (record.evidence.length === 0) throw new Error("Mission outcomes require evidence before learning approval");

  return {
    ...record,
    approvedForLearning: true,
    approvedBy: approver,
    approvedAt: timestamp.toISOString(),
  };
}
