import { describe, expect, it, vi } from "vitest";
import { classifyExternalSource, searchResearchSources } from "./research-retrieval";

describe("classifyExternalSource", () => {
  it("recognizes government, primary research, documentation, and reputable secondary sources", () => {
    expect(classifyExternalSource("https://www.irs.gov/forms-pubs/about-form-1099-nec")).toBe("government_or_regulator");
    expect(classifyExternalSource("https://arxiv.org/abs/1234.5678")).toBe("primary_research");
    expect(classifyExternalSource("https://docs.example.com/accounting/posting")).toBe("primary_documentation");
    expect(classifyExternalSource("https://www.reuters.com/world/example")).toBe("reputable_secondary");
  });

  it("fails closed for malformed and ordinary domains", () => {
    expect(classifyExternalSource("not-a-url")).toBe("community_or_unverified");
    expect(classifyExternalSource("https://example.com/blog")).toBe("community_or_unverified");
  });
});

describe("searchResearchSources", () => {
  it("normalizes, sanitizes, deduplicates, and risk-classifies live results", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        web: [
          {
            title: "IRS guidance",
            url: "https://www.irs.gov/example",
            description: "<b>Official</b> tax guidance",
            markdown: "# Guidance\nUse the applicable form.",
          },
          {
            title: "Duplicate",
            url: "https://www.irs.gov/example",
          },
          {
            title: "Accounting article",
            url: "https://example.com/accounting",
            description: "Context",
          },
        ],
      },
    }), { status: 200 })) as typeof fetch;

    const result = await searchResearchSources("How should this tax transaction be recorded?", {
      apiKey: "fc-test",
      fetchImpl,
      now: () => new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(result.risk).toBe("high");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      sourceClass: "government_or_regulator",
      supports: "context_only",
      description: "Official tax guidance",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/search",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("rejects empty, oversized, unconfigured, and unsuccessful requests", async () => {
    await expect(searchResearchSources(" ", { apiKey: "fc-test" })).rejects.toThrow("required");
    await expect(searchResearchSources("x".repeat(501), { apiKey: "fc-test" })).rejects.toThrow("500");
    await expect(searchResearchSources("normal question", { apiKey: "" })).rejects.toThrow("not configured");

    const fetchImpl = vi.fn(async () => new Response("no", { status: 429 })) as typeof fetch;
    await expect(searchResearchSources("normal question", { apiKey: "fc-test", fetchImpl })).rejects.toThrow("429");
  });
});
