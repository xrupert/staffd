import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { researchReviewPatch, type ResearchReviewDecision } from "../../_lib/orchestrator/research-review";
import type { ResearchRecord } from "../../_lib/orchestrator/research-records";

type StoredResearchRecord = ResearchRecord & { id: string };

async function ownerRecord(recordId: string, userId: string): Promise<StoredResearchRecord | null> {
  const token = await getAdminToken();
  const filter = `id = '${pbEscape(recordId)}' && user = '${pbEscape(userId)}'`;
  const response = await fetch(
    `${pbUrl()}/api/collections/research_records/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Research record lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: StoredResearchRecord[] };
  return payload.items?.[0] ?? null;
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const token = await getAdminToken();
    const filter = `user = '${pbEscape(user.id)}' && review_status = 'pending'`;
    const params = new URLSearchParams({
      filter,
      sort: "-verified_at",
      perPage: "50",
    });
    const response = await fetch(
      `${pbUrl()}/api/collections/research_records/records?${params.toString()}`,
      { headers: { Authorization: token }, cache: "no-store" },
    );
    if (!response.ok) throw new Error(`Research review queue failed (${response.status})`);
    const payload = (await response.json()) as { items?: StoredResearchRecord[] };
    return Response.json({ items: payload.items ?? [] });
  } catch (error) {
    return Response.json({
      error: "research_review_queue_failed",
      detail: error instanceof Error ? error.message : "Unknown research queue error",
    }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; decision?: ResearchReviewDecision };
  try {
    body = (await request.json()) as { id?: string; decision?: ResearchReviewDecision };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  if (!id || !body.decision) {
    return Response.json({ error: "record_id_and_decision_required" }, { status: 400 });
  }

  try {
    const record = await ownerRecord(id, user.id);
    if (!record) return Response.json({ error: "not_found" }, { status: 404 });
    const patch = researchReviewPatch(record.review_status, body.decision, user.id);
    const token = await getAdminToken();
    const response = await fetch(`${pbUrl()}/api/collections/research_records/records/${record.id}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify(patch),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Research review update failed (${response.status})`);
    return Response.json({ record: await response.json() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown research review error";
    const invalidTransition = /cannot transition|decision is invalid|requires a reviewer/i.test(detail);
    return Response.json({
      error: invalidTransition ? "invalid_research_review_transition" : "research_review_update_failed",
      detail,
    }, { status: invalidTransition ? 409 : 503 });
  }
}
