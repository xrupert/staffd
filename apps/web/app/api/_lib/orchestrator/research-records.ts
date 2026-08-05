import type { ResearchVerificationBundle } from "./research-verification";

export type ResearchReviewStatus = "not_required" | "pending" | "approved" | "rejected" | "superseded";

export type ResearchRecord = {
  id?: string;
  user: string;
  bundle_id: string;
  topic: string;
  claim: string;
  label: ResearchVerificationBundle["label"];
  risk: ResearchVerificationBundle["risk"];
  verified_at: string;
  reverify_after: string;
  verdict: ResearchVerificationBundle["verdict"];
  citations: ResearchVerificationBundle["citations"];
  answer: ResearchVerificationBundle["answer"];
  review_status: ResearchReviewStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export type ResearchRecordStore = {
  create: (record: ResearchRecord) => Promise<{ id: string }>;
};

function validDate(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Research verification timestamp is invalid");
  return parsed;
}

export function researchRecordFromBundle(
  userId: string,
  bundle: ResearchVerificationBundle,
): ResearchRecord {
  const user = userId.trim();
  if (!user) throw new Error("Research record requires an owner");
  const verifiedAt = validDate(bundle.verifiedAt);
  const freshnessDays = bundle.risk === "high" || bundle.citations.some((citation) => citation.publishedAt)
    ? 120
    : 365;
  const reverifyAfter = new Date(verifiedAt.getTime() + freshnessDays * 86_400_000).toISOString();

  return {
    user,
    bundle_id: bundle.id,
    topic: bundle.topic,
    claim: bundle.claim,
    label: bundle.label,
    risk: bundle.risk,
    verified_at: bundle.verifiedAt,
    reverify_after: reverifyAfter,
    verdict: bundle.verdict,
    citations: bundle.citations,
    answer: bundle.answer,
    review_status: bundle.answer.requiresHumanReview ? "pending" : "not_required",
    reviewed_at: null,
    reviewed_by: null,
  };
}

export async function persistResearchBundle(
  userId: string,
  bundle: ResearchVerificationBundle,
  store: ResearchRecordStore,
): Promise<{ id: string; reviewStatus: ResearchReviewStatus }> {
  const record = researchRecordFromBundle(userId, bundle);
  const created = await store.create(record);
  if (!created.id) throw new Error("Research record persistence returned no record ID");
  return { id: created.id, reviewStatus: record.review_status };
}
