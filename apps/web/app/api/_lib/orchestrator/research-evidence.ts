export type ResearchRisk = "standard" | "high";
export type EvidenceLabel = "fact" | "inference" | "assumption" | "unknown";
export type SourceClass =
  | "approved_internal"
  | "government_or_regulator"
  | "primary_documentation"
  | "primary_research"
  | "reputable_secondary"
  | "community_or_unverified";

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  sourceClass: SourceClass;
  publishedAt?: string | null;
  retrievedAt: string;
  supports: "supports" | "contradicts" | "context_only";
  excerpt?: string;
};

export type ResearchClaim = {
  statement: string;
  label: EvidenceLabel;
  timeSensitive: boolean;
  sources: ResearchSource[];
};

export type ResearchVerdict = {
  answerable: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  agreement: "none" | "mixed" | "corroborated";
  requiresHumanReview: boolean;
  sourceIds: string[];
};

const AUTHORITATIVE = new Set<SourceClass>([
  "approved_internal",
  "government_or_regulator",
  "primary_documentation",
  "primary_research",
]);

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isFresh(source: ResearchSource, now: Date, maxAgeDays: number): boolean {
  const date = validDate(source.publishedAt) ?? validDate(source.retrievedAt);
  if (!date || date.getTime() > now.getTime()) return false;
  return now.getTime() - date.getTime() <= maxAgeDays * 86_400_000;
}

export function evaluateResearchClaim(
  claim: ResearchClaim,
  risk: ResearchRisk,
  now = new Date(),
): ResearchVerdict {
  const usable = claim.sources.filter((source) => source.id.trim() && source.title.trim() && source.url.trim());
  const supporting = usable.filter((source) => source.supports === "supports");
  const contradicting = usable.filter((source) => source.supports === "contradicts");
  const authoritativeSupport = supporting.filter((source) => AUTHORITATIVE.has(source.sourceClass));
  const independentAuthorities = new Set(authoritativeSupport.map((source) => {
    try {
      return new URL(source.url).hostname.toLowerCase();
    } catch {
      return source.url;
    }
  }));
  const maxAgeDays = claim.timeSensitive ? 120 : 1_825;
  const freshAuthorities = authoritativeSupport.filter((source) => isFresh(source, now, maxAgeDays));
  const agreement = contradicting.length
    ? supporting.length ? "mixed" : "none"
    : supporting.length >= 2 ? "corroborated" : "none";

  if (claim.label === "unknown") {
    return {
      answerable: false,
      confidence: "low",
      reason: "The claim is explicitly unknown and requires more evidence.",
      agreement,
      requiresHumanReview: risk === "high",
      sourceIds: usable.map((source) => source.id),
    };
  }

  if (supporting.length === 0) {
    return {
      answerable: false,
      confidence: "low",
      reason: "No source supports the claim.",
      agreement,
      requiresHumanReview: risk === "high",
      sourceIds: usable.map((source) => source.id),
    };
  }

  if (contradicting.length > 0) {
    return {
      answerable: false,
      confidence: "low",
      reason: "Material source disagreement remains unresolved.",
      agreement: "mixed",
      requiresHumanReview: true,
      sourceIds: usable.map((source) => source.id),
    };
  }

  if (claim.label === "assumption") {
    return {
      answerable: false,
      confidence: "low",
      reason: "An assumption cannot be promoted to fact without verification.",
      agreement,
      requiresHumanReview: risk === "high",
      sourceIds: usable.map((source) => source.id),
    };
  }

  if (risk === "high") {
    if (independentAuthorities.size < 2) {
      return {
        answerable: false,
        confidence: "low",
        reason: "High-risk claims require two independent authoritative sources.",
        agreement,
        requiresHumanReview: true,
        sourceIds: usable.map((source) => source.id),
      };
    }
    if (claim.timeSensitive && freshAuthorities.length < 2) {
      return {
        answerable: false,
        confidence: "low",
        reason: "High-risk time-sensitive claims require two current authoritative sources.",
        agreement,
        requiresHumanReview: true,
        sourceIds: usable.map((source) => source.id),
      };
    }
    return {
      answerable: true,
      confidence: "high",
      reason: "Independent authoritative sources agree and satisfy the high-risk evidence threshold.",
      agreement: "corroborated",
      requiresHumanReview: true,
      sourceIds: usable.map((source) => source.id),
    };
  }

  if (authoritativeSupport.length >= 2 || (authoritativeSupport.length >= 1 && supporting.length >= 2)) {
    return {
      answerable: true,
      confidence: "high",
      reason: "The claim is corroborated by authoritative and independent evidence.",
      agreement: "corroborated",
      requiresHumanReview: false,
      sourceIds: usable.map((source) => source.id),
    };
  }

  if (authoritativeSupport.length === 1) {
    return {
      answerable: true,
      confidence: "medium",
      reason: "One authoritative source supports the claim; additional corroboration would improve confidence.",
      agreement,
      requiresHumanReview: false,
      sourceIds: usable.map((source) => source.id),
    };
  }

  return {
    answerable: claim.label === "inference",
    confidence: "low",
    reason: claim.label === "inference"
      ? "The conclusion is an inference supported only by non-authoritative evidence."
      : "A factual claim needs at least one authoritative source.",
    agreement,
    requiresHumanReview: false,
    sourceIds: usable.map((source) => source.id),
  };
}

export function researchRiskForTopic(topic: string): ResearchRisk {
  return /\b(legal|law|tax|accounting|medical|health|employment|payroll|financial|investment|compliance|regulation)\b/i.test(topic)
    ? "high"
    : "standard";
}
