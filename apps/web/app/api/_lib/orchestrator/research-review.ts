import type { ResearchReviewStatus } from "./research-records";

export type ResearchReviewDecision = "approved" | "rejected";

export type ResearchReviewPatch = {
  review_status: ResearchReviewDecision;
  reviewed_at: string;
  reviewed_by: string;
};

export function researchReviewPatch(
  currentStatus: ResearchReviewStatus,
  decision: ResearchReviewDecision,
  reviewerId: string,
  now = new Date(),
): ResearchReviewPatch {
  if (currentStatus !== "pending") {
    throw new Error(`Research review cannot transition from ${currentStatus}`);
  }
  const reviewer = reviewerId.trim();
  if (!reviewer) throw new Error("Research review requires a reviewer");
  if (!Number.isFinite(now.getTime())) throw new Error("Research review timestamp is invalid");
  if (!(["approved", "rejected"] as const).includes(decision)) {
    throw new Error("Research review decision is invalid");
  }
  return {
    review_status: decision,
    reviewed_at: now.toISOString(),
    reviewed_by: reviewer,
  };
}
