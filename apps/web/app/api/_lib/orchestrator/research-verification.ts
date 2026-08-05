import {
  evaluateResearchClaim,
  researchRiskForTopic,
  type EvidenceLabel,
  type ResearchClaim,
  type ResearchSource,
  type ResearchVerdict,
} from "./research-evidence";

export type ClassifiedResearchSource = ResearchSource & {
  excerpt?: string;
};

export type ResearchVerificationRequest = {
  topic: string;
  claim: string;
  label: EvidenceLabel;
  timeSensitive?: boolean;
  sources: ClassifiedResearchSource[];
};

export type ResearchCitation = {
  id: string;
  title: string;
  url: string;
  sourceClass: ResearchSource["sourceClass"];
  publishedAt?: string | null;
  retrievedAt: string;
  relationship: ResearchSource["supports"];
  excerpt?: string;
};

export type ResearchVerificationBundle = {
  id: string;
  topic: string;
  claim: string;
  label: EvidenceLabel;
  risk: ReturnType<typeof researchRiskForTopic>;
  verifiedAt: string;
  verdict: ResearchVerdict;
  citations: ResearchCitation[];
  answer: {
    supported: boolean;
    confidence: ResearchVerdict["confidence"];
    statement: string | null;
    reason: string;
    requiresHumanReview: boolean;
  };
};

function stableId(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `research-${(hash >>> 0).toString(36)}`;
}

function clean(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validateSource(source: ClassifiedResearchSource): ResearchCitation {
  const title = clean(source.title, 240);
  const url = source.url.trim();
  if (!source.id.trim()) throw new Error("Every research source requires an ID");
  if (!title) throw new Error(`Research source ${source.id} requires a title`);
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error(`Research source ${source.id} requires a valid HTTP(S) URL`);
  }
  if (!Number.isFinite(new Date(source.retrievedAt).getTime())) {
    throw new Error(`Research source ${source.id} requires a valid retrieval timestamp`);
  }

  return {
    id: source.id,
    title,
    url,
    sourceClass: source.sourceClass,
    publishedAt: source.publishedAt ?? null,
    retrievedAt: source.retrievedAt,
    relationship: source.supports,
    excerpt: source.excerpt ? clean(source.excerpt, 1_500) : undefined,
  };
}

export function verifyResearchClaim(
  request: ResearchVerificationRequest,
  now = new Date(),
): ResearchVerificationBundle {
  const topic = clean(request.topic, 500);
  const statement = clean(request.claim, 2_000);
  if (!topic) throw new Error("Research topic is required");
  if (!statement) throw new Error("Research claim is required");
  if (request.sources.length === 0) throw new Error("At least one research source is required");
  if (!Number.isFinite(now.getTime())) throw new Error("Verification time is invalid");

  const uniqueIds = new Set<string>();
  const uniqueUrls = new Set<string>();
  const citations = request.sources.map((source) => {
    const citation = validateSource(source);
    if (uniqueIds.has(citation.id)) throw new Error(`Duplicate research source ID: ${citation.id}`);
    if (uniqueUrls.has(citation.url)) throw new Error(`Duplicate research source URL: ${citation.url}`);
    uniqueIds.add(citation.id);
    uniqueUrls.add(citation.url);
    return citation;
  });

  const risk = researchRiskForTopic(topic);
  const claim: ResearchClaim = {
    statement,
    label: request.label,
    timeSensitive: request.timeSensitive ?? false,
    sources: request.sources,
  };
  const verdict = evaluateResearchClaim(claim, risk, now);
  const verifiedAt = now.toISOString();

  return {
    id: stableId(`${topic}\n${statement}\n${citations.map((source) => `${source.id}:${source.relationship}`).join("|")}`),
    topic,
    claim: statement,
    label: request.label,
    risk,
    verifiedAt,
    verdict,
    citations,
    answer: {
      supported: verdict.answerable,
      confidence: verdict.confidence,
      statement: verdict.answerable ? statement : null,
      reason: verdict.reason,
      requiresHumanReview: verdict.requiresHumanReview,
    },
  };
}
