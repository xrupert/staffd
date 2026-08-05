import { researchRiskForTopic, type ResearchRisk, type ResearchSource, type SourceClass } from "./research-evidence";

export type ResearchCandidate = Omit<ResearchSource, "supports"> & {
  description: string;
  supports: "context_only";
};

export type ResearchSearchResult = {
  query: string;
  risk: ResearchRisk;
  candidates: ResearchCandidate[];
  provider: "firecrawl";
  retrievedAt: string;
};

export type ResearchRetrievalDeps = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type FirecrawlResult = {
  title?: string;
  description?: string;
  url?: string;
  markdown?: string;
  metadata?: {
    title?: string;
    description?: string;
    sourceURL?: string;
  };
};

type FirecrawlResponse = {
  success?: boolean;
  data?: { web?: FirecrawlResult[] } | FirecrawlResult[];
};

const GOVERNMENT_SUFFIXES = [".gov", ".gov.uk", ".gc.ca", ".europa.eu"];
const PRIMARY_RESEARCH_HOSTS = new Set([
  "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "nature.com",
  "science.org",
  "acm.org",
  "ieee.org",
]);
const REPUTABLE_SECONDARY_HOSTS = new Set([
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
]);

function hostnameFor(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifyExternalSource(url: string): SourceClass {
  const hostname = hostnameFor(url);
  if (!hostname) return "community_or_unverified";
  if (GOVERNMENT_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) {
    return "government_or_regulator";
  }
  if (PRIMARY_RESEARCH_HOSTS.has(hostname) || [...PRIMARY_RESEARCH_HOSTS].some((host) => hostname.endsWith(`.${host}`))) {
    return "primary_research";
  }
  if (hostname.startsWith("docs.") || hostname.startsWith("developer.") || hostname.startsWith("support.")) {
    return "primary_documentation";
  }
  if (REPUTABLE_SECONDARY_HOSTS.has(hostname) || [...REPUTABLE_SECONDARY_HOSTS].some((host) => hostname.endsWith(`.${host}`))) {
    return "reputable_secondary";
  }
  return "community_or_unverified";
}

function cleanText(value: string | undefined, maxLength: number): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeResults(payload: FirecrawlResponse): FirecrawlResult[] {
  if (Array.isArray(payload.data)) return payload.data;
  return payload.data?.web ?? [];
}

export async function searchResearchSources(
  rawQuery: string,
  deps: ResearchRetrievalDeps = {},
): Promise<ResearchSearchResult> {
  const query = rawQuery.trim();
  if (!query) throw new Error("Research query is required");
  if (query.length > 500) throw new Error("Research query exceeds 500 characters");

  const apiKey = deps.apiKey ?? process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) throw new Error("Research retrieval is not configured");

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? new Date();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetchImpl("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 8,
        sources: ["web"],
        country: "US",
        timeout: 15_000,
        ignoreInvalidURLs: true,
        scrapeOptions: { formats: [{ type: "markdown" }] },
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Research provider failed (${response.status})`);
    const payload = (await response.json()) as FirecrawlResponse;
    if (!payload.success) throw new Error("Research provider returned an unsuccessful response");

    const seen = new Set<string>();
    const retrievedAt = now.toISOString();
    const candidates = normalizeResults(payload)
      .map((result, index): ResearchCandidate | null => {
        const url = result.url ?? result.metadata?.sourceURL ?? "";
        const title = cleanText(result.title ?? result.metadata?.title, 240);
        if (!url || !title || seen.has(url)) return null;
        seen.add(url);
        return {
          id: `research-source-${index + 1}`,
          title,
          url,
          sourceClass: classifyExternalSource(url),
          retrievedAt,
          supports: "context_only",
          description: cleanText(result.description ?? result.metadata?.description, 500),
          excerpt: cleanText(result.markdown, 1_500),
        };
      })
      .filter((candidate): candidate is ResearchCandidate => candidate !== null);

    return {
      query,
      risk: researchRiskForTopic(query),
      candidates,
      provider: "firecrawl",
      retrievedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
