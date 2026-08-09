import type { MissionOutcomeRecord } from "./mission-memory";

export type StoredMissionOutcome = {
  outcome_id: string;
  user: string;
  mission_id: string;
  hypothesis: string;
  expected_outcome: string;
  actual_outcome: string;
  outcome_status: MissionOutcomeRecord["status"];
  metrics: MissionOutcomeRecord["metrics"];
  evidence: string[];
  lesson: string;
  confidence_before: number;
  confidence_after: number;
  observed_at: string;
  approved_for_learning: boolean;
  approved_by: string | null;
  approved_at: string | null;
};

export function toStoredMissionOutcome(record: MissionOutcomeRecord): StoredMissionOutcome {
  return {
    outcome_id: record.id,
    user: record.ownerId,
    mission_id: record.missionId,
    hypothesis: record.hypothesis,
    expected_outcome: record.expectedOutcome,
    actual_outcome: record.actualOutcome,
    outcome_status: record.status,
    metrics: record.metrics,
    evidence: record.evidence,
    lesson: record.lesson,
    confidence_before: record.confidenceBefore,
    confidence_after: record.confidenceAfter,
    observed_at: record.observedAt,
    approved_for_learning: record.approvedForLearning,
    approved_by: record.approvedBy,
    approved_at: record.approvedAt,
  };
}

export function fromStoredMissionOutcome(record: StoredMissionOutcome): MissionOutcomeRecord {
  return {
    id: record.outcome_id,
    ownerId: record.user,
    missionId: record.mission_id,
    hypothesis: record.hypothesis,
    expectedOutcome: record.expected_outcome,
    actualOutcome: record.actual_outcome,
    status: record.outcome_status,
    metrics: record.metrics,
    evidence: record.evidence,
    lesson: record.lesson,
    confidenceBefore: record.confidence_before,
    confidenceAfter: record.confidence_after,
    observedAt: record.observed_at,
    approvedForLearning: record.approved_for_learning,
    approvedBy: record.approved_by,
    approvedAt: record.approved_at,
  };
}
