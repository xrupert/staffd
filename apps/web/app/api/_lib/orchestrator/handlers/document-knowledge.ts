import { BUSINESS_KNOWLEDGE_KINDS, type BusinessKnowledgeKind } from "../business-knowledge";
import type { DocumentKnowledgeCandidate } from "../document-knowledge-extraction";
import { callLLM } from "../llm";

const MAX_CHARS_PER_CHUNK = 30_000;
const MAX_CHUNKS = 6;
const MAX_CANDIDATES = 100;
const KIND_SET = new Set<string>(BUSINESS_KNOWLEDGE_KINDS);

const SYSTEM = `You extract explicit business knowledge from owner-provided documents for STAFFD's Business Brain.
Return ONLY a JSON array. Never use markdown fences or commentary.
Each item must have exactly these fields:
- kind: one of ${BUSINESS_KNOWLEDGE_KINDS.join(", ")}
- subject: concise noun phrase naming what the knowledge is about
- statement: a faithful, standalone statement supported by the document text
- confidence: number from 0 to 1 reflecting extraction certainty, not truth beyond the document
- usageScopes: non-empty array of plain business scopes such as operations, finance, marketing, sales, support, legal, hr, leadership
- sourceLocation: optional short locator such as a heading, section, page reference, or null
- effectiveAt: optional ISO date when explicitly stated, otherwise null

Rules:
1. Extract only information explicitly supported by the supplied document. Do not add outside knowledge or infer missing policy.
2. Prefer policies, processes, rules, preferences, decisions, risks, entities, and durable business facts that can help future work.
3. Do not turn examples, hypothetical language, questions, marketing puffery, or source instructions into business policy.
4. Preserve exceptions, thresholds, approvals, conditions, and negations in the statement.
5. If the text contains no durable business knowledge, return [].
6. Do not approve knowledge. All extracted items are observations requiring governance downstream.`;

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function chunks(text: string): string[] {
  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) return [];
  const result: string[] = [];
  for (let start = 0; start < normalized.length && result.length < MAX_CHUNKS; start += MAX_CHARS_PER_CHUNK) {
    result.push(normalized.slice(start, start + MAX_CHARS_PER_CHUNK));
  }
  return result;
}

function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Document knowledge extraction must return a JSON array");
  return parsed;
}

function candidate(value: unknown): DocumentKnowledgeCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Document knowledge candidate must be an object");
  const row = value as Record<string, unknown>;
  const kind = typeof row.kind === "string" ? row.kind : "";
  if (!KIND_SET.has(kind)) throw new Error(`Document knowledge candidate kind is invalid: ${kind || "missing"}`);
  const subject = clean(typeof row.subject === "string" ? row.subject : "", 500);
  const statement = clean(typeof row.statement === "string" ? row.statement : "", 4_000);
  if (!subject || !statement) throw new Error("Document knowledge candidate requires subject and statement");
  const confidence = Number(row.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Document knowledge candidate confidence is invalid");
  if (!Array.isArray(row.usageScopes)) throw new Error("Document knowledge candidate requires usage scopes");
  const usageScopes = [...new Set(row.usageScopes.filter((item): item is string => typeof item === "string").map((item) => clean(item, 100)).filter(Boolean))];
  if (!usageScopes.length) throw new Error("Document knowledge candidate requires usage scopes");
  const sourceLocation = row.sourceLocation == null ? null : clean(String(row.sourceLocation), 500);
  let effectiveAt: string | null = null;
  if (row.effectiveAt != null && String(row.effectiveAt).trim()) {
    const parsed = new Date(String(row.effectiveAt));
    if (!Number.isFinite(parsed.getTime())) throw new Error("Document knowledge candidate effective date is invalid");
    effectiveAt = parsed.toISOString();
  }
  return {
    kind: kind as BusinessKnowledgeKind,
    subject,
    statement,
    confidence,
    usageScopes,
    sourceLocation,
    effectiveAt,
  };
}

export type DocumentKnowledgeExtractionResult = {
  candidates: DocumentKnowledgeCandidate[];
  costUsd: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  truncated: boolean;
};

export async function extractDocumentKnowledgeCandidates(text: string): Promise<DocumentKnowledgeExtractionResult> {
  const parts = chunks(text);
  if (!parts.length) return { candidates: [], costUsd: 0, latencyMs: 0, tokensIn: 0, tokensOut: 0, truncated: false };

  const collected: DocumentKnowledgeCandidate[] = [];
  let costUsd = 0;
  let latencyMs = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (let index = 0; index < parts.length && collected.length < MAX_CANDIDATES; index++) {
    const result = await callLLM({
      intent: "synthesize",
      system: SYSTEM,
      messages: [{ role: "user", content: `Document chunk ${index + 1} of ${parts.length}:\n\n${parts[index]}` }],
    });
    costUsd += result.costUsd ?? 0;
    latencyMs += result.latencyMs;
    if (!result.ok) throw new Error(`Document knowledge extraction failed: ${result.fallback}`);
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    for (const raw of parseJsonArray(result.text)) {
      collected.push(candidate(raw));
      if (collected.length >= MAX_CANDIDATES) break;
    }
  }

  const unique = new Map<string, DocumentKnowledgeCandidate>();
  for (const item of collected) {
    const key = `${item.kind}\n${item.subject.toLowerCase()}\n${item.statement.toLowerCase()}`;
    const previous = unique.get(key);
    if (!previous || item.confidence > previous.confidence) unique.set(key, item);
  }

  return {
    candidates: [...unique.values()].slice(0, MAX_CANDIDATES),
    costUsd,
    latencyMs,
    tokensIn,
    tokensOut,
    truncated: text.replace(/\u0000/g, "").trim().length > MAX_CHARS_PER_CHUNK * MAX_CHUNKS,
  };
}
