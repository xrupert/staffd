/**
 * W62 — Analyzer + action vocabulary pipeline tests.
 *
 * The SDK is stubbed with crafted classifier outputs per case — these pin
 * the PIPELINE (vocabulary enforcement, threshold gating, validation,
 * params passthrough, failure fallback, D-19 context injection). True
 * classification quality is an LLM property verified by live smoke, not
 * unit tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  reply: "[]" as string,
  fail: 0,
  systems: [] as string[],
  calls: 0,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = {
      create: async (args: { system: string }) => {
        sdkMocks.calls += 1;
        sdkMocks.systems.push(args.system);
        if (sdkMocks.fail > 0) {
          sdkMocks.fail -= 1;
          throw new Error("upstream");
        }
        return { content: [{ type: "text", text: sdkMocks.reply }] };
      },
    };
  },
}));

import { analyzeOutput } from "../../app/api/_lib/orchestrator/analyzer";
import {
  ACTION_VOCABULARY,
  CONFIDENCE_THRESHOLD,
  validateCandidates,
} from "../../app/api/_lib/orchestrator/action-vocabulary";

beforeEach(() => {
  sdkMocks.reply = "[]";
  sdkMocks.fail = 0;
  sdkMocks.systems = [];
  sdkMocks.calls = 0;
});

const BASE = { prompt: "write instagram ad copy", department: "marketing" };

describe("action vocabulary (W62)", () => {
  it("is locked at exactly 6 actions — growth requires explicit SA authorization", () => {
    expect(ACTION_VOCABULARY).toHaveLength(6);
    expect(ACTION_VOCABULARY.map((a) => a.id).sort()).toEqual([
      "draft_email", "export_document", "generate_image",
      "generate_video", "publish_social", "schedule_followup",
    ]);
  });

  it("ship threshold is 0.6 (per-action calibration is post-V1 W62.1)", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  it("validation drops non-vocabulary ids, clamps confidence, requires reason", () => {
    const out = validateCandidates([
      { id: "generate_image", confidence: 0.9, reason: "hashtag-shaped copy" },
      { id: "send_to_sales", confidence: 0.95, reason: "cut action — must drop" },
      { id: "delete_everything", confidence: 1, reason: "hostile — must drop" },
      { id: "generate_video", confidence: 1.7, reason: "clamped to 1" },
      { id: "draft_email", confidence: 0.8, reason: "" }, // empty reason — drop
      { id: "publish_social", confidence: 0.59, reason: "below threshold — drop" },
    ]);
    expect(out.map((c) => c.id)).toEqual(["generate_image", "generate_video"]);
    expect(out[1]!.confidence).toBe(1);
  });

  it("params are sanitized to short string maps", () => {
    const out = validateCandidates([
      { id: "publish_social", confidence: 0.8, reason: "platform-tagged", params: { platform: "instagram", junk: 42, nested: { a: 1 } } },
    ]);
    expect(out[0]!.params).toEqual({ platform: "instagram" });
  });
});

describe("analyzeOutput pipeline (W62)", () => {
  it("ad copy → image + publish candidates pass the gate (Test 1 representative)", async () => {
    sdkMocks.reply = JSON.stringify([
      { id: "generate_image", confidence: 0.92, reason: "Ad copy explicitly describes a visual scene.", params: { platform: "instagram" } },
      { id: "publish_social", confidence: 0.85, reason: "Hashtags and platform tag present." },
      { id: "export_document", confidence: 0.2, reason: "weak" },
    ]);
    const out = await analyzeOutput({ ...BASE, output: "🍝 Fresh pasta daily! #brooklyn #italianfood — IG caption + alt text..." });
    expect(out.map((c) => c.id)).toEqual(["generate_image", "publish_social"]);
    expect(out[0]!.reason).toContain("visual scene");
  });

  it("internal memo → empty (classifier says nothing applies)", async () => {
    sdkMocks.reply = "[]";
    const out = await analyzeOutput({ ...BASE, prompt: "internal memo", output: "Team — reminder that the office closes early Friday." });
    expect(out).toEqual([]);
  });

  it("empty output short-circuits without an SDK call", async () => {
    const out = await analyzeOutput({ ...BASE, output: "   " });
    expect(out).toEqual([]);
    expect(sdkMocks.calls).toBe(0);
  });

  it("retries once, then fails to empty with a warn log (never throws)", async () => {
    sdkMocks.fail = 2; // first attempt + retry both fail
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await analyzeOutput({ ...BASE, output: "some work" });
    expect(out).toEqual([]);
    expect(sdkMocks.calls).toBe(2);
    expect(warnSpy.mock.calls.flat().join("\n")).toContain("[W62-analyzer]");
    warnSpy.mockRestore();
  });

  it("one transient failure recovers on retry", async () => {
    sdkMocks.fail = 1;
    sdkMocks.reply = JSON.stringify([{ id: "draft_email", confidence: 0.7, reason: "launch-shaped" }]);
    const out = await analyzeOutput({ ...BASE, output: "Product launch announcement..." });
    expect(out.map((c) => c.id)).toEqual(["draft_email"]);
    expect(sdkMocks.calls).toBe(2);
  });

  it("D-19 slim context appears in the classifier prompt for a bridged user (Test 5)", async () => {
    await analyzeOutput({
      ...BASE,
      output: "Tuesday lunch special menu copy...",
      industryContext: { pack: "restaurants", positioning: "Only fresh-pasta kitchen in the area", hardNos: "Never discount the tasting menu", serviceArea: "Carroll Gardens" },
    });
    const system = sdkMocks.systems[0]!;
    expect(system).toContain("Industry: restaurants");
    expect(system).toContain("Positioning: Only fresh-pasta kitchen");
    expect(system).toContain("Hard nos: Never discount");
    expect(system).toContain("Service area: Carroll Gardens");
  });

  it("generic user (no pack) gets no industry context block (Test 5b)", async () => {
    await analyzeOutput({ ...BASE, output: "Generic blog post...", industryContext: { pack: null } });
    expect(sdkMocks.systems[0]!).not.toContain("BUSINESS CONTEXT");
  });

  it("non-vocabulary classifier output is dropped at validation (Test 3)", async () => {
    sdkMocks.reply = JSON.stringify([
      { id: "launch_rocket", confidence: 0.99, reason: "made up" },
      { id: "schedule_followup", confidence: 0.75, reason: "campaign implies a next touch" },
    ]);
    const out = await analyzeOutput({ ...BASE, output: "3-email campaign sequence..." });
    expect(out.map((c) => c.id)).toEqual(["schedule_followup"]);
  });
});
