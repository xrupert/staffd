/**
 * PR-Tranche-1.7 — muapi vendor-reconnect tests (W16).
 *
 * Covers the canonical Muapi API contract lifted in PR-Tranche-1.7:
 *   - routeImageModel returns one of: ideogram-v3-t2i, midjourney-v7-text-to-image,
 *     flux-dev-image
 *   - routeVideoModel returns one of: veo3-text-to-video,
 *     openai-sora-2-pro-text-to-video, runway-text-to-video
 *   - submitPrediction sends x-api-key header (NOT Authorization: Bearer)
 *   - submitPrediction sends FLAT body — no `input` envelope wrapper
 *   - tryExtractOutputUrl tries outputs[0] → url → output.url in that order
 *   - publish/route.ts returns 410 with the exact brand-voiced JSON body
 *
 * Mocks global fetch + _lib/pb to avoid touching real Muapi.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock super-admin helpers so muapi route doesn't try to fetch user records
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  trySuperAdminByUserId: async () => null,
}));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({
  logSuperAdminUsage: async () => undefined,
}));

// Anthropic gets called by enrichToPrompt — stub it
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({ content: [{ type: "text", text: "stubbed enriched prompt" }] }),
    };
  },
}));

// Ensure MUAPI_API_KEY is set so the route doesn't 503-bail
process.env.MUAPI_API_KEY = "test_muapi_key_abc";
process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.example.test";

import { __test } from "../../app/api/integrations/muapi/route";
import { GET, POST, PUT, PATCH, DELETE } from "../../app/api/integrations/muapi/publish/route";

// W95.7.3d-h1 — routeImageModel/routeVideoModel removed (legacy hardcoded-slug
// fallback deleted; model routing is now resolveModel → routeFor + catalog).
const { tryExtractOutputUrl, submitPrediction } = __test;

// W95.7.3d-h1 — the routeImageModel / routeVideoModel legacy prompt-based
// routers (hardcoded slugs) are removed; model routing is now resolveModel →
// routeFor + the generation_models catalog (see generation-routing.test.ts +
// muapi-h1-resolve.test.ts). Only the vendor-contract helpers remain pinned here.

// ─── submitPrediction: auth header + flat body ──────────────────────────

describe("submitPrediction (PR-Tranche-1.7 contract)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let lastCall: { url: string; init: RequestInit } | null;

  beforeEach(() => {
    lastCall = null;
    fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      lastCall = { url: typeof url === "string" ? url : url.toString(), init: init ?? {} };
      return {
        ok: true,
        status: 200,
        json: async () => ({ request_id: "req_123", status: "queued" }),
        text: async () => "",
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends x-api-key header (NOT Authorization: Bearer)", async () => {
    await submitPrediction("flux-dev-image", { prompt: "test", aspect_ratio: "1:1" });
    expect(lastCall).not.toBeNull();
    const headers = lastCall!.init.headers as Record<string, string>;
    // The header NAME contract is what matters — value comes from
    // process.env at module-load time which precedes test setup
    expect("x-api-key" in headers).toBe(true);
    expect(typeof headers["x-api-key"]).toBe("string");
    // Crucially: NO Authorization header at all (no Bearer leak)
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  it("sends FLAT body — no `input` envelope wrapper", async () => {
    await submitPrediction("flux-dev-image", { prompt: "hello", aspect_ratio: "16:9" });
    const body = JSON.parse(lastCall!.init.body as string);
    // The W16 contract: fields at root, not wrapped
    expect(body.prompt).toBe("hello");
    expect(body.aspect_ratio).toBe("16:9");
    expect(body).not.toHaveProperty("input");
  });

  it("hits /api/v1/{model} path", async () => {
    await submitPrediction("ideogram-v3-t2i", { prompt: "test" });
    expect(lastCall!.url).toMatch(/\/api\/v1\/ideogram-v3-t2i$/);
  });
});

// ─── tryExtractOutputUrl: try outputs[0] → url → output.url ─────────────

describe("tryExtractOutputUrl (PR-Tranche-1.7 extraction order)", () => {
  it("returns outputs[0] when present", () => {
    expect(
      tryExtractOutputUrl({
        outputs: ["https://cdn.muapi.ai/a.png"],
        url: "https://cdn.muapi.ai/b.png",
        output: { url: "https://cdn.muapi.ai/c.png" },
      }),
    ).toBe("https://cdn.muapi.ai/a.png");
  });

  it("falls back to url when outputs[] is missing/empty", () => {
    expect(
      tryExtractOutputUrl({
        url: "https://cdn.muapi.ai/b.png",
        output: { url: "https://cdn.muapi.ai/c.png" },
      }),
    ).toBe("https://cdn.muapi.ai/b.png");
  });

  it("falls back to output.url when outputs[] and url both missing", () => {
    expect(tryExtractOutputUrl({ output: { url: "https://cdn.muapi.ai/c.png" } })).toBe(
      "https://cdn.muapi.ai/c.png",
    );
  });

  it("returns null when no URL anywhere", () => {
    expect(tryExtractOutputUrl({ status: "queued" })).toBeNull();
  });

  it("preserves order: outputs[0] beats url beats output.url", () => {
    // Even when output.url is alphabetically/semantically richer, outputs[0] wins
    const result = tryExtractOutputUrl({
      outputs: ["FIRST"],
      url: "SECOND",
      output: { url: "THIRD" },
    });
    expect(result).toBe("FIRST");
  });
});

// ─── publish/route.ts: 410 Gone with brand-voiced body ─────────────────

describe("publish/route.ts (PR-Tranche-1.7 W17 stub)", () => {
  const EXPECTED_BODY = {
    status: "queued_for_platform_publish",
    message:
      "Your Social Media Strategist drafted this post and the captions are tuned per platform. Direct posting to YouTube and TikTok is being added to the staff this cycle; for now your media + captions are ready to publish from your account in under a minute.",
    next_actions: [
      { label: "Download media", kind: "download" },
      { label: "Copy caption", kind: "copy" },
    ],
  };

  it("POST returns 410 with the exact brand-voiced JSON body", async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toEqual(EXPECTED_BODY);
  });

  it("GET returns the same 410 body (every method gated)", async () => {
    const res = await GET();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(EXPECTED_BODY);
  });

  it("PUT returns 410 too", async () => {
    const res = await PUT();
    expect(res.status).toBe(410);
  });

  it("PATCH returns 410 too", async () => {
    const res = await PATCH();
    expect(res.status).toBe(410);
  });

  it("DELETE returns 410 too", async () => {
    const res = await DELETE();
    expect(res.status).toBe(410);
  });
});
