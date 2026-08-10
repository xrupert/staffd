import type { WorkflowTask } from "../workflow";
import { pbEscape } from "../pb";
import { extractDocumentKnowledgeCandidates } from "../orchestrator/handlers/document-knowledge";
import { documentCandidatesToObservations } from "../orchestrator/document-knowledge-extraction";
import { toStoredBusinessKnowledge } from "../orchestrator/business-knowledge-store";

export type DocumentBusinessBrainContext = {
  pb: string;
  adminToken: string;
  authHeaders: Record<string, string>;
};

type StoredDocument = {
  id: string;
  user: string;
  file?: string;
  prompt?: string;
  output?: string;
  created?: string;
  extraction_status?: string;
};

function titleFor(document: StoredDocument): string {
  return document.file?.trim() || document.prompt?.trim() || `Document ${document.id}`;
}

function uploadedAtFor(document: StoredDocument): string {
  if (document.created) {
    const parsed = new Date(document.created);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

async function existingObservation(
  ctx: DocumentBusinessBrainContext,
  ownerId: string,
  documentId: string,
  subject: string,
): Promise<boolean> {
  const filter = `user = '${pbEscape(ownerId)}' && sources ~ '${pbEscape(documentId)}' && subject = '${pbEscape(subject)}' && superseded_by_id = ''`;
  const response = await fetch(
    `${ctx.pb}/api/collections/business_knowledge/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: { Authorization: ctx.adminToken }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Business Brain observation lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: unknown[] };
  return (payload.items?.length ?? 0) > 0;
}

export async function runDocumentBusinessBrainWorker(
  task: WorkflowTask,
  ctx: DocumentBusinessBrainContext,
): Promise<{ text: string; tokensActual: number }> {
  const input = task.input_payload as { document_id?: string };
  const documentId = input.document_id?.trim() ?? "";
  if (!documentId) throw new Error("business brain extraction: missing document_id");

  const response = await fetch(`${ctx.pb}/api/collections/documents/records/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: ctx.adminToken },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`business brain extraction: document fetch failed (${response.status})`);
  const document = (await response.json()) as StoredDocument;
  if (document.user !== task.user) throw new Error("business brain extraction: tenant mismatch");
  if (document.extraction_status !== "extracted") throw new Error("business brain extraction: document text is not ready");
  const text = document.output?.trim() ?? "";
  if (!text || text.startsWith("[Document uploaded — no readable text")) {
    return { text: "business-brain:skipped-no-readable-text", tokensActual: 0 };
  }

  const extraction = await extractDocumentKnowledgeCandidates(text);
  if (!extraction.candidates.length) {
    return { text: "business-brain:no-durable-knowledge", tokensActual: extraction.tokensIn + extraction.tokensOut };
  }

  const observations = documentCandidatesToObservations({
    id: document.id,
    ownerId: task.user,
    title: titleFor(document),
    uri: `document://${document.id}`,
    uploadedAt: uploadedAtFor(document),
  }, extraction.candidates);

  let created = 0;
  let existing = 0;
  for (const observation of observations) {
    if (await existingObservation(ctx, task.user, document.id, observation.subject)) {
      existing += 1;
      continue;
    }
    const createResponse = await fetch(`${ctx.pb}/api/collections/business_knowledge/records`, {
      method: "POST",
      headers: ctx.authHeaders,
      body: JSON.stringify(toStoredBusinessKnowledge(observation)),
      cache: "no-store",
    });
    if (!createResponse.ok) throw new Error(`Business Brain observation creation failed (${createResponse.status})`);
    created += 1;
  }

  return {
    text: `business-brain:created=${created}:existing=${existing}:truncated=${extraction.truncated}`,
    tokensActual: extraction.tokensIn + extraction.tokensOut,
  };
}
