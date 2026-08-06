import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { approvedResearchToKnowledge } from "../../_lib/orchestrator/research-to-knowledge";
import { toStoredBusinessKnowledge } from "../../_lib/orchestrator/business-knowledge-store";
import type { BusinessKnowledgeKind } from "../../_lib/orchestrator/business-knowledge";
import type { ResearchRecord } from "../../_lib/orchestrator/research-records";

type StoredResearchRecord = ResearchRecord & { id: string };

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { researchId?: string; kind?: BusinessKnowledgeKind; usageScopes?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const researchId = body.researchId?.trim() ?? "";
  const usageScopes = [...new Set((body.usageScopes ?? []).map((scope) => scope.trim()).filter(Boolean))];
  if (!researchId || !body.kind || usageScopes.length === 0) {
    return Response.json({ error: "research_id_kind_and_usage_scopes_required" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    const researchFilter = `id = '${pbEscape(researchId)}' && user = '${pbEscape(user.id)}'`;
    const researchResponse = await fetch(
      `${pbUrl()}/api/collections/research_records/records?filter=${encodeURIComponent(researchFilter)}&perPage=1`,
      { headers: { Authorization: token }, cache: "no-store" },
    );
    if (!researchResponse.ok) throw new Error(`Research lookup failed (${researchResponse.status})`);
    const researchPayload = (await researchResponse.json()) as { items?: StoredResearchRecord[] };
    const research = researchPayload.items?.[0];
    if (!research) return Response.json({ error: "not_found" }, { status: 404 });

    const sourceFilter = `user = '${pbEscape(user.id)}' && sources ~ '${pbEscape(research.id)}' && superseded_by_id = ''`;
    const existingResponse = await fetch(
      `${pbUrl()}/api/collections/business_knowledge/records?filter=${encodeURIComponent(sourceFilter)}&perPage=1`,
      { headers: { Authorization: token }, cache: "no-store" },
    );
    if (!existingResponse.ok) throw new Error(`Knowledge idempotency lookup failed (${existingResponse.status})`);
    const existing = (await existingResponse.json()) as { items?: unknown[] };
    if ((existing.items?.length ?? 0) > 0) {
      return Response.json({ status: "already_promoted", record: existing.items?.[0] });
    }

    const knowledge = approvedResearchToKnowledge({ research, kind: body.kind, usageScopes });
    const stored = toStoredBusinessKnowledge(knowledge);
    const createResponse = await fetch(`${pbUrl()}/api/collections/business_knowledge/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(stored),
      cache: "no-store",
    });
    if (!createResponse.ok) throw new Error(`Knowledge promotion failed (${createResponse.status})`);
    return Response.json({ status: "promoted", record: await createResponse.json() }, { status: 201 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown promotion error";
    const invalid = /owner-approved|reviewer identity|usage scope/i.test(detail);
    return Response.json({
      error: invalid ? "research_not_eligible_for_knowledge" : "research_knowledge_promotion_failed",
      detail,
    }, { status: invalid ? 409 : 503 });
  }
}
