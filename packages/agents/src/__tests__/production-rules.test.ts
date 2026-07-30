/**
 * PR-Studio — producible-first rule: video-script specialists default to
 * formats the staff can fully produce; camera-facing only when the
 * customer chooses it. (Live incident: "a TikTok video" produced an
 * unrequested talking-head script.)
 */

import { describe, it, expect } from "vitest";
import { allAgents } from "../index";
import { applyProductionRules, PRODUCIBLE_FIRST_RULE } from "../production-rules";

describe("producible-first rule (PR-Studio)", () => {
  it("video-tagged specialists carry the rule", () => {
    const tiktok = allAgents.find((a) => a.tags?.some((t) => t.toLowerCase() === "tiktok"));
    expect(tiktok, "expected at least one tiktok-tagged specialist").toBeTruthy();
    expect(tiktok!.systemPrompt).toContain("VIDEO FORMAT RULE");
    expect(tiktok!.systemPrompt).toContain("FULLY PRODUCE");
  });

  it("non-video specialists (e.g. legal) do NOT carry it", () => {
    const legal = allAgents.find((a) => a.department === "legal");
    expect(legal?.systemPrompt).not.toContain("VIDEO FORMAT RULE");
  });

  it("design department carries it (visual production owners)", () => {
    const design = allAgents.find((a) => a.department === "design");
    expect(design?.systemPrompt).toContain("VIDEO FORMAT RULE");
  });

  it("the rule keeps camera-facing as an opt-in variant, never the default", () => {
    expect(PRODUCIBLE_FIRST_RULE).toContain("OPTIONAL VARIANT");
    expect(applyProductionRules("base", ["tiktok"], "marketing")).toContain("VIDEO FORMAT RULE");
    expect(applyProductionRules("base", ["contract"], "legal")).toBe("base");
  });
});
