/**
 * Routing-quality fix — suggestDepartmentFromKeywords.
 *
 * The Haiku router mis-routed obvious requests ("draft an NDA for a
 * contractor" → Marketing instead of Legal). A deterministic keyword hint
 * steers the clearly-unambiguous cases into the routing prompt as a strong
 * signal, while ambiguous requests return null and stay the LLM's call.
 */

import { describe, it, expect, vi } from "vitest";

// route.ts transitively constructs `new Anthropic()` — stub the SDK so the
// import succeeds (this pure helper never touches it).
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = { create: async () => ({}), stream: () => ({}) };
  },
}));

import { suggestDepartmentFromKeywords } from "../../app/api/_lib/orchestrator/handlers/route";

describe("suggestDepartmentFromKeywords", () => {
  it("routes an NDA / contract request to legal", () => {
    expect(suggestDepartmentFromKeywords("draft an NDA for a contractor")).toBe("legal");
    expect(suggestDepartmentFromKeywords("write a non-disclosure agreement")).toBe("legal");
    expect(suggestDepartmentFromKeywords("review this contract for risk")).toBe("legal");
  });

  it("routes an invoice / bookkeeping request to finance", () => {
    expect(suggestDepartmentFromKeywords("create an invoice for a $2,500 job")).toBe("finance");
    expect(suggestDepartmentFromKeywords("build a profit and loss statement")).toBe("finance");
  });

  it("routes a job posting request to hr", () => {
    expect(suggestDepartmentFromKeywords("write a job posting for a sales rep")).toBe("hr");
  });

  it("routes an SOP request to operations", () => {
    expect(suggestDepartmentFromKeywords("write an SOP for our shipping process")).toBe("operations");
  });

  it("returns null for ambiguous requests — the LLM decides", () => {
    expect(suggestDepartmentFromKeywords("write today's social post for my business")).toBeNull();
    expect(suggestDepartmentFromKeywords("help me with SEO")).toBeNull();
    expect(suggestDepartmentFromKeywords("give me some ideas")).toBeNull();
  });
});
