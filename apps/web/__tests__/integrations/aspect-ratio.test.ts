/**
 * PR-Tranche-2 Item 2 — Smart aspect ratio auto-selection tests.
 *
 * Covers:
 *   - Each documented output-type signal → expected ratio
 *   - Explicit override always wins
 *   - Default fallback (1:1 image, 16:9 video)
 *   - Invalid explicit ratio falls back to smart selection
 */

import { describe, it, expect, vi } from "vitest";

// Mock Anthropic SDK — muapi/route.ts initializes a client at module load.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: "text", text: "" }] }) };
  },
}));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  trySuperAdminByUserId: async () => null,
}));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({
  logSuperAdminUsage: async () => undefined,
}));

process.env.MUAPI_API_KEY = "test_key";
process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.example.test";

import { resolveAspectRatio } from "../../app/api/integrations/muapi/route";

describe("resolveAspectRatio (PR-Tranche-2 Item 2 / Decision 8)", () => {
  it("returns 9:16 for TikTok prompts", () => {
    expect(resolveAspectRatio("video", undefined, "Make a TikTok video showing the new product")).toBe("9:16");
  });

  it("returns 9:16 for Instagram Reels", () => {
    expect(resolveAspectRatio("video", undefined, "An Instagram Reel for the brand launch")).toBe("9:16");
  });

  it("returns 9:16 for YouTube Shorts", () => {
    expect(resolveAspectRatio("video", undefined, "YouTube shorts trailer for the campaign")).toBe("9:16");
  });

  it("returns 16:9 for YouTube long-form", () => {
    expect(resolveAspectRatio("video", undefined, "YouTube landscape video tutorial")).toBe("16:9");
  });

  it("returns 16:9 for hero banner / blog header", () => {
    expect(resolveAspectRatio("image", undefined, "Hero banner for the homepage")).toBe("16:9");
  });

  it("returns 2:3 for Pinterest pins", () => {
    expect(resolveAspectRatio("image", undefined, "Pinterest pin for the new collection")).toBe("2:3");
  });

  it("returns 1:1 for Instagram feed", () => {
    expect(resolveAspectRatio("image", undefined, "Instagram post for tomorrow's promo")).toBe("1:1");
  });

  it("returns 21:9 for ultrawide cinematic", () => {
    expect(resolveAspectRatio("video", undefined, "Ultrawide cinematic open")).toBe("21:9");
  });

  it("returns 4:5 for magazine editorial", () => {
    expect(resolveAspectRatio("image", undefined, "Magazine editorial layout for the brand story")).toBe("4:5");
  });

  it("defaults to 1:1 for images with no signal", () => {
    expect(resolveAspectRatio("image", undefined, "A red apple")).toBe("1:1");
  });

  it("defaults to 16:9 for videos with no signal", () => {
    expect(resolveAspectRatio("video", undefined, "A red apple")).toBe("16:9");
  });

  it("respects explicit valid override over smart selection", () => {
    // Prompt would route to 9:16, but operator explicitly requested 1:1
    expect(resolveAspectRatio("video", "1:1", "TikTok video")).toBe("1:1");
  });

  it("falls back to smart selection when explicit value is invalid", () => {
    expect(resolveAspectRatio("video", "garbage", "TikTok video")).toBe("9:16");
  });
});
