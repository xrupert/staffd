import { whoAmI } from "../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import {
  promoteKnowledge,
  validateBusinessKnowledge,
  type BusinessKnowledgeRecord,
  type PromotionEvidence,
} from "../_lib/orchestrator/business-knowledge";
import {
  fromStoredBusinessKnowledge,
  toStoredBusinessKnowledge,
  type StoredBusinessKnowledge,
} from "../_lib/orchestrator/business-knowledge-store";

async function ownerRecord(id: string, userId: string): Promise<StoredBusinessKnowledge | null> {
  const token = await getAdminToken();
  const filter = `id = '${pbEscape(id)}' && user = '${pbEscape(userId)}'`;
  const response = await fetch(
    `${pbUrl()}/api/collections/business_knowledge/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Business knowledge lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: StoredBusinessKnowledge[] };
  return payload.items?.[0] ?? null;
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope")?.trim();
  const stage = url.searchParams.get("stage")?.trim();
  const clauses = [`user = '${pbEscape(user.id)}'`, "superseded_by_id = ''"];
  if (stage) clauses.push(`stage = '${pbEscape(stage)}'`);
  if (scope) clauses.push(`usage_scopes ~ '${pbEscape(scope)}'`);

  try {
    const token = await getAdminToken();
    const params = new URLSearchParams({ filter: clauses.join(" && "), sort: "-created", perPage: "100" });
    const response = await fetch(`${pbUrl()}/api/collections/business_knowledge/records?${params}`, {
      headers: { Authorization: token }, cache: "no-store",
    });
    if (!response.ok) throw new Error(`Business knowledge query failed (${response.status})`);
    const payload = (await response.json()) as { items?: StoredBusinessKnowledge[] };
    return Response.json({ items: (payload.items ?? []).map(fromStoredBusinessKnowledge) });
  } catch (error) {
    return Response.json({ error: "business_knowledge_query_failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const input = (await request.json()) as Omit<BusinessKnowledgeRecord, "id" | "ownerId" | "stage">;
    const record: BusinessKnowledgeRecord = { ...input, id: "pending", ownerId: user.id, stage: "observed" };
    validateBusinessKnowledge(record);
    const token = await getAdminToken();
    const payload = toStoredBusinessKnowledge(record);
    const { user: owner, ...withoutOwner } = payload;
    const response = await fetch(`${pbUrl()}/api/collections/business_knowledge/records`, {
      method: "POST", headers: adminHeaders(token), body: JSON.stringify({ ...withoutOwner, user: owner }), cache: "no-store",
    });
    if (!response.ok) throw new Error(`Business knowledge creation failed (${response.status})`);
    return Response.json({ record: fromStoredBusinessKnowledge((await response.json()) as StoredBusinessKnowledge) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: "business_knowledge_creation_failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; evidence?: PromotionEvidence };
  try { body = (await request.json()) as { id?: string; evidence?: PromotionEvidence }; }
  catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.id || !body.evidence) return Response.json({ error: "record_id_and_evidence_required" }, { status: 400 });

  try {
    const stored = await ownerRecord(body.id, user.id);
    if (!stored) return Response.json({ error: "not_found" }, { status: 404 });
    const prior = fromStoredBusinessKnowledge(stored);
    const promoted = promoteKnowledge(prior, body.evidence, user.id);
    const token = await getAdminToken();
    const promotedPayload = toStoredBusinessKnowledge({ ...promoted, id: "pending", supersedesId: prior.id });
    const createResponse = await fetch(`${pbUrl()}/api/collections/business_knowledge/records`, {
      method: "POST", headers: adminHeaders(token), body: JSON.stringify(promotedPayload), cache: "no-store",
    });
    if (!createResponse.ok) throw new Error(`Knowledge promotion creation failed (${createResponse.status})`);
    const created = (await createResponse.json()) as StoredBusinessKnowledge;

    const linkResponse = await fetch(`${pbUrl()}/api/collections/business_knowledge/records/${prior.id}`, {
      method: "PATCH", headers: adminHeaders(token), body: JSON.stringify({ superseded_by_id: created.id }), cache: "no-store",
    });
    if (!linkResponse.ok) {
      await fetch(`${pbUrl()}/api/collections/business_knowledge/records/${created.id}`, { method: "DELETE", headers: { Authorization: token } });
      throw new Error(`Knowledge promotion linkage failed (${linkResponse.status})`);
    }
    return Response.json({ record: fromStoredBusinessKnowledge(created) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const invalid = /cannot be promoted|requires|Contradicted|owner approval/i.test(detail);
    return Response.json({ error: invalid ? "invalid_knowledge_transition" : "business_knowledge_update_failed", detail }, { status: invalid ? 409 : 503 });
  }
}
