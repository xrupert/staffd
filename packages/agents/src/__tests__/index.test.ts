/**
 * PR-Bundle-3-A — applyBrandLaws regression test.
 *
 * Refactor verification: the registry-level `applyBrandLaws` (private in
 * index.ts) now delegates to the new exported `applyBrandLawsToPrompt`
 * helper. This test verifies the refactored output is identical in shape
 * to the pre-refactor behavior — every agent's systemPrompt contains the
 * brand laws preamble.
 */

import { describe, it, expect } from "vitest";
import { allAgents, applyBrandLawsToPrompt } from "../index";

describe("applyBrandLaws regression (PR-Bundle-3-A refactor verification)", () => {
  it("all agents have brand laws applied to system prompts", () => {
    // Sample 3 agents from different tiers (Bundle 1 sampled-diversity
    // pattern): one core dept, one pack, one CEO.
    const sampleIds = [
      "marketing-content-creator", // core marketing
      "ceo-chief-of-staff", // CEO tier
      "pack-trades-marketing-local-seo", // pack agent
    ];

    for (const id of sampleIds) {
      const agent = allAgents.find((a) => a.id === id);
      expect(agent, `agent ${id} not found in registry`).toBeDefined();
      expect(agent!.systemPrompt).toContain("Zero-Confusion");
      expect(agent!.systemPrompt).toContain("STAFFD never executes");
      expect(agent!.systemPrompt).toContain("Never refer the user outside STAFFD");
    }
  });

  it("registry agent count matches expectation (138 total)", () => {
    // 83 core (10 dept files) + 55 pack agents (8 pack files) = 138
    expect(allAgents.length).toBe(138);
  });

  it("every agent in the registry has brand laws applied (full sweep)", () => {
    for (const agent of allAgents) {
      expect(
        agent.systemPrompt,
        `agent ${agent.id} missing brand laws preamble`,
      ).toContain("STAFFD BRAND LAWS");
    }
  });

  it("registry output equals direct applyBrandLawsToPrompt application", () => {
    // For any sampled agent, the registry-level prompt should be identical
    // to applying the per-prompt helper to a raw stripped version. This is
    // a structural check that the refactor in index.ts changed nothing.
    const sample = allAgents.find((a) => a.id === "marketing-seo-specialist");
    expect(sample).toBeDefined();

    // Build a synthetic "raw" prompt by stripping the brand-laws preamble.
    // The preamble is delimited by "\n\n---\n\n" so we split on that.
    const parts = sample!.systemPrompt.split("\n\n---\n\n");
    expect(parts.length).toBeGreaterThanOrEqual(2);

    const reconstructed = applyBrandLawsToPrompt(parts.slice(1).join("\n\n---\n\n"));
    expect(reconstructed).toBe(sample!.systemPrompt);
  });
});
