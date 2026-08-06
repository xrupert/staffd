import { whoAmI } from "../../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../../_lib/pb";
import {
  documentCandidatesToObservations,
  type DocumentKnowledgeCandidate,
} from "../../../_lib/orchestrator/document-knowledge-extraction";
import { toStoredBusinessKnowledge } from "../../../_lib/orchestrator/business-knowledge-store";

type StoredDocument = {
  id: string;
  user: string;
  file?: string;
  prompt?: string;
  created?: string;
  extraction_status?: string;
};

type RequestBody = {
  documentId?: string;
  candidates?: DocumentKnowledgeCandidate[];
};

function documentTitle(document: StoredDocument): string {
  return document.file?.trim() || document.prompt?.trim() || `Document ${document.id}`;
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const documentId = body.documentId?.trim() ?? "";
  if (!documentId || !Array.isArray(body.candidates) || body.candidates.length === 0) {
    return Response.json({ error: "document_id_and_candidates_required" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    const documentResponse = await fetch(`${pbUrl()}/api/collections/documents/records/${encodeURIComponent(documentId)}`, {
      headers: { Authorization: token },
      cache: "no-store",
    });
    if (!documentResponse.ok) {
      return Response.json({ error: "document_not_found" }, { status: 404 });
    }

    const document = (await documentResponse.json()) as StoredDocument;
    if (document.user !== user.id) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (document.extraction_status && document.extraction_status !== "extracted") {
      return Response.json({ error: "document_text_not_ready" }, { status: 409 });
    }

    const uploadedAt = document.created && Number.isFinite(new Date(document.created).getTime())
      ? new Date(document.created).toISOString()
      : new Date().toISOString();
    const observations = documentCandidatesToObservations({
      id: document.id,
      ownerId: user.id,
      title: documentTitle(document),
      uri: `document://${document.id}`,
      uploadedAt,
    }, body.candidates);

    const created: unknown[] = [];
    let existing = 0;
    for (const observation of observations) {
      const sourceNeedle = pbEscape(document.id);
      const subjectNeedle = pbEscape(observation.subject);
      const filter = `user = '${pbEscape(user.id)}' && sources ~ '${sourceNeedle}' && subject = '${subjectNeedle}' && superseded_by_id = ''`;
      const lookup = await fetch(
        `${pbUrl()}/api/collections/business_knowledge/records?filter=${encodeURIComponent(filter)}&perPage=1`,
        { headers: { Authorization: token }, cache: "no-store" },
      );
      if (!lookup.ok) throw new Error(`Knowledge idempotency lookup failed (${lookup.status})`);
      const matches = (await lookup.json()) as { items?: unknown[] };
      if ((matches.items?.length ?? 0) > 0) {
        existing += 1;
        continue;
      }

      const createResponse = await fetch(`${pbUrl()}/api/collections/business_knowledge/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify(toStoredBusinessKnowledge(observation)),
        cache: "no-store",
      });
      if (!createResponse.ok) throw new Error(`Knowledge observation creation failed (${createResponse.status})`);
      created.push(await createResponse.json());
    }

    return Response.json({
      status: created.length ? "observations_created" : "already_observed",
      created: created.length,
      existing,
      records: created,
    }, { status: created.length ? 201 : 200 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown document observation error";
    const invalid = /candidate|timestamp|confidence|usage scope|source identity|requires/i.test(detail);
    return Response.json({
      error: invalid ? "invalid_document_observations" : "document_observation_persistence_failed",
      detail,
    }, { status: invalid ? 400 : 503 });
  }
}
