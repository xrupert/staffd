export type ResearchKnowledgeRecord = {
  id: string;
  user: string;
  topic: string;
  claim: string;
  risk: "standard" | "high";
  review_status: "not_required" | "pending" | "approved" | "rejected";
  verified_at: string;
  reverify_after?: string | null;
  superseded_by?: string | null;
};

export type ReverificationDecision = {
  due: boolean;
  reason: "approved_knowledge_expired" | "not_approved" | "not_due" | "already_superseded" | "invalid_deadline";
};

export function evaluateReverification(
  record: ResearchKnowledgeRecord,
  now = new Date(),
): ReverificationDecision {
  if (record.superseded_by) return { due: false, reason: "already_superseded" };
  if (record.review_status !== "approved" && record.review_status !== "not_required") {
    return { due: false, reason: "not_approved" };
  }
  if (!record.reverify_after) return { due: false, reason: "not_due" };

  const deadline = new Date(record.reverify_after);
  if (!Number.isFinite(deadline.getTime()) || !Number.isFinite(now.getTime())) {
    return { due: false, reason: "invalid_deadline" };
  }

  return deadline.getTime() <= now.getTime()
    ? { due: true, reason: "approved_knowledge_expired" }
    : { due: false, reason: "not_due" };
}

export function nextReverificationDeadline(risk: ResearchKnowledgeRecord["risk"], from = new Date()): string {
  if (!Number.isFinite(from.getTime())) throw new Error("Re-verification start time is invalid");
  const days = risk === "high" ? 30 : 90;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

export function buildReverificationQuery(record: ResearchKnowledgeRecord): string {
  const topic = record.topic.replace(/\s+/g, " ").trim();
  const claim = record.claim.replace(/\s+/g, " ").trim();
  if (!topic || !claim) throw new Error("Re-verification requires a topic and claim");
  return `Verify whether this current claim remains accurate: ${claim}. Topic: ${topic}. Prefer current primary and authoritative sources, identify disagreement, and do not assume the prior conclusion is still correct.`;
}
