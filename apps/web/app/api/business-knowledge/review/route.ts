import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { reviewObservedKnowledge, type OwnerKnowledgeDecision } from "../../_lib/orchestrator/business-knowledge";
import { fromStoredBusinessKnowledge, toStoredBusinessKnowledge, type StoredBusinessKnowledge } from "../../_lib/orchestrator/business-knowledge-store";

type ReviewBody = {
  id?: string;
  decision?: OwnerKnowledgeDecision;
  replacement?: { subject?: string; statement?: string };
};

async function ownerObservation(id: string, ownerId: string, token: string) {
  const filter = `id = '${pbEscape(id)}' && user = '${pbEscape(ownerId)}'`;
  const response = await fetch(`${pbUrl()}/api/collections/business_knowledge/records?filter=${encodeURIComponent(filter)}&perPage=1`, {
    headers: { Authorization: token }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Business knowledge lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: StoredBusinessKnowledge[] };
  return payload.items?.[0] ?? null;
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: ReviewBody;
  try { body = (await request.json()) as ReviewBody; }
  catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.id || !body.decision || !["approve", "reject", "supersede"].includes(body.decision)) {
    return Response.json({ error: "record_id_and_valid_decision_required" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    const stored = await ownerObservation(body.id, user.id, token);
    if (!stored) return Response.json({ error: "not_found" }, { status: 404 });
    const replacement = body.replacement?.subject && body.replacement.statement
      ? { subject: body.replacement.subject, statement: body.replacement.statement }
      : undefined;
    const reviewed = reviewObservedKnowledge(fromStoredBusinessKnowledge(stored), body.decision, user.id, replacement);

    let approved: StoredBusinessKnowledge | undefined;
    if (reviewed.approved) {
      const response = await fetch(`${pbUrl()}/api/collections/business_knowledge/records`, {
        method: "POST", headers: adminHeaders(token), body: JSON.stringify(toStoredBusinessKnowledge(reviewed.approved)), cache: "no-store",
      });
      if (!response.ok) throw new Error(`Approved knowledge creation failed (${response.status})`);
      approved = (await response.json()) as StoredBusinessKnowledge;
    }

    const priorResponse = await fetch(`${pbUrl()}/api/collections/business_knowledge/records/${stored.id}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({
        review_status: reviewed.prior.reviewStatus,
        reviewed_by: reviewed.prior.reviewedBy,
        reviewed_at: reviewed.prior.reviewedAt,
        superseded_by_id: approved?.id ?? null,
      }),
      cache: "no-store",
    });
    if (!priorResponse.ok) {
      if (approved) await fetch(`${pbUrl()}/api/collections/business_knowledge/records/${approved.id}`, { method: "DELETE", headers: { Authorization: token } });
      throw new Error(`Knowledge review linkage failed (${priorResponse.status})`);
    }

    return Response.json({ decision: body.decision, record: approved ? fromStoredBusinessKnowledge(approved) : null });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const invalid = /Only pending|identity|required/i.test(detail);
    return Response.json({ error: invalid ? "invalid_knowledge_review" : "business_knowledge_review_failed", detail }, { status: invalid ? 409 : 503 });
  }
}
