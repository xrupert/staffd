import { randomUUID } from "node:crypto";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { documentCandidatesToObservations } from "../../_lib/orchestrator/document-knowledge-extraction";
import { toStoredBusinessKnowledge } from "../../_lib/orchestrator/business-knowledge-store";
import { extractDocumentKnowledgeCandidates } from "../../_lib/worker/document-knowledge-ai";

const RECORDS_PER_TICK = 10;
const MAX_ATTEMPTS = 3;
const CLAIM_TTL_MS = 15 * 60_000;

type StoredDocument = {
  id: string;
  user: string;
  file?: string;
  prompt?: string;
  created?: string;
  output?: string;
  extraction_status?: string;
  knowledge_extraction_status?: string;
  knowledge_extraction_attempts?: number;
  knowledge_extraction_claim_id?: string;
  knowledge_extraction_claimed_at?: string;
};

function authorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const workerHeader = request.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";
  return Boolean(
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (workerSecret && workerHeader === workerSecret),
  );
}

function recentClaim(document: StoredDocument, now: Date): boolean {
  if (document.knowledge_extraction_status !== "processing") return false;
  const claimed = new Date(document.knowledge_extraction_claimed_at ?? "");
  return Number.isFinite(claimed.getTime()) && now.getTime() - claimed.getTime() < CLAIM_TTL_MS;
}

async function patchDocument(id: string, patch: Record<string, unknown>, token: string): Promise<boolean> {
  const response = await fetch(`${pbUrl()}/api/collections/documents/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  return response.ok;
}

async function refetchDocument(id: string, token: string): Promise<StoredDocument | null> {
  const response = await fetch(`${pbUrl()}/api/collections/documents/records/${encodeURIComponent(id)}`, {
    headers: { Authorization: token }, cache: "no-store",
  });
  return response.ok ? response.json() as Promise<StoredDocument> : null;
}

async function persistObservations(document: StoredDocument, token: string, now: Date) {
  const text = document.output?.trim() ?? "";
  const extracted = await extractDocumentKnowledgeCandidates(text, document.file?.trim() || document.prompt?.trim() || `Document ${document.id}`);
  if (!extracted.candidates.length) return { created: 0, existing: 0, tokensActual: extracted.tokensActual };

  const uploadedAt = document.created && Number.isFinite(new Date(document.created).getTime())
    ? new Date(document.created).toISOString()
    : now.toISOString();
  const observations = documentCandidatesToObservations({
    id: document.id,
    ownerId: document.user,
    title: document.file?.trim() || document.prompt?.trim() || `Document ${document.id}`,
    uri: `document://${document.id}`,
    uploadedAt,
  }, extracted.candidates);

  let created = 0;
  let existing = 0;
  for (const observation of observations) {
    const filter = `user = '${pbEscape(document.user)}' && sources ~ '${pbEscape(document.id)}' && subject = '${pbEscape(observation.subject)}' && superseded_by_id = ''`;
    const lookup = await fetch(
      `${pbUrl()}/api/collections/business_knowledge/records?filter=${encodeURIComponent(filter)}&perPage=1`,
      { headers: { Authorization: token }, cache: "no-store" },
    );
    if (!lookup.ok) throw new Error(`Knowledge idempotency lookup failed (${lookup.status})`);
    const matches = (await lookup.json()) as { items?: unknown[] };
    if ((matches.items?.length ?? 0) > 0) {
      existing++;
      continue;
    }
    const response = await fetch(`${pbUrl()}/api/collections/business_knowledge/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(toStoredBusinessKnowledge(observation)),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Knowledge observation creation failed (${response.status})`);
    created++;
  }
  return { created, existing, tokensActual: extracted.tokensActual };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const filter = encodeURIComponent(
    `extraction_status = "extracted" && knowledge_extraction_status != "complete" && knowledge_extraction_status != "empty" && knowledge_extraction_attempts < ${MAX_ATTEMPTS}`,
  );
  const response = await fetch(
    `${pbUrl()}/api/collections/documents/records?filter=${filter}&sort=created&perPage=${RECORDS_PER_TICK}`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (response.status === 400 || response.status === 404) {
    return Response.json({ error: "document_knowledge_setup_required" }, { status: 503 });
  }
  if (!response.ok) return Response.json({ error: "document_knowledge_query_failed" }, { status: 502 });

  const documents = ((await response.json()) as { items?: StoredDocument[] }).items ?? [];
  const now = new Date();
  let processed = 0;
  let empty = 0;
  let failed = 0;
  let skipped = 0;
  let observationsCreated = 0;
  let tokensActual = 0;

  for (const document of documents) {
    if (!document.id?.trim() || !document.user?.trim() || recentClaim(document, now)) {
      skipped++;
      continue;
    }
    const claimId = randomUUID();
    const attempts = Math.max(0, document.knowledge_extraction_attempts ?? 0) + 1;
    const claimed = await patchDocument(document.id, {
      knowledge_extraction_status: "processing",
      knowledge_extraction_attempts: attempts,
      knowledge_extraction_claim_id: claimId,
      knowledge_extraction_claimed_at: now.toISOString(),
      knowledge_extraction_error: "",
    }, token);
    if (!claimed) {
      failed++;
      continue;
    }

    const ownedClaim = await refetchDocument(document.id, token);
    if (!ownedClaim || ownedClaim.knowledge_extraction_claim_id !== claimId) {
      skipped++;
      continue;
    }

    try {
      const result = await persistObservations(ownedClaim, token, now);
      observationsCreated += result.created;
      tokensActual += result.tokensActual;
      const status = result.created + result.existing > 0 ? "complete" : "empty";
      await patchDocument(document.id, {
        knowledge_extraction_status: status,
        knowledge_extracted_at: new Date().toISOString(),
        knowledge_extraction_claim_id: "",
        knowledge_extraction_claimed_at: "",
        knowledge_extraction_error: "",
      }, token);
      if (status === "empty") empty++;
      else processed++;
    } catch (error) {
      failed++;
      const detail = error instanceof Error ? error.message : "Unknown document knowledge error";
      console.error(`[document_knowledge] doc=${document.id} attempt=${attempts} failed: ${detail}`);
      await patchDocument(document.id, {
        knowledge_extraction_status: "error",
        knowledge_extraction_claim_id: "",
        knowledge_extraction_claimed_at: "",
        knowledge_extraction_error: detail.slice(0, 500),
      }, token);
    }
  }

  return Response.json({
    ok: true,
    scanned: documents.length,
    processed,
    empty,
    failed,
    skipped,
    observationsCreated,
    tokensActual,
  });
}
