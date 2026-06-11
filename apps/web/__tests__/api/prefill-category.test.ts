/**
 * W59 Test 10 — prefill auto-populates industry_category when the scraped
 * industry phrase resolves to a known category.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const anthropicMock = vi.hoisted(() => ({
  extracted: { business_name: "Luigi's", industry: "Italian restaurant", description: "d", target_audience: "t" },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(anthropicMock.extracted) }],
      }),
    };
  },
}));

import { POST } from "../../app/api/prefill/route";

beforeEach(() => {
  anthropicMock.extracted = {
    business_name: "Luigi's", industry: "Italian restaurant", description: "d", target_audience: "t",
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    text: async () => "<html><body>Luigi's Italian Restaurant</body></html>",
  })));
});

function prefillRequest() {
  return new Request("https://test.local/api/prefill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://luigis.example" }),
  });
}

describe("/api/prefill (W59 category auto-populate)", () => {
  it("includes industry_category when the scraped industry resolves (Test 10)", async () => {
    const res = await POST(prefillRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { industry: string; industry_category?: string };
    expect(body.industry).toBe("Italian restaurant");
    expect(body.industry_category).toBe("restaurants");
  });

  it("omits industry_category when the industry doesn't resolve", async () => {
    anthropicMock.extracted = {
      business_name: "Acme", industry: "Industrial manufacturing", description: "d", target_audience: "t",
    };
    const res = await POST(prefillRequest());
    const body = (await res.json()) as { industry_category?: string };
    expect("industry_category" in body).toBe(false);
  });
});
