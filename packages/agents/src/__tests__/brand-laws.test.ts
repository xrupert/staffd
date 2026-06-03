/**
 * PR-Bundle-3-A — STAFFD Brand Laws + applyBrandLawsToPrompt tests.
 *
 * Verifies the Zero-Confusion Output Rule + No-External-Execution Rule
 * are present in the preamble (single edit → 138-agent reach via
 * applyBrandLaws in index.ts). Also covers the new exported per-prompt
 * helper added per PR-Bundle-3-A Path 1.
 */

import { describe, it, expect } from "vitest";
import { STAFFD_BRAND_LAWS, applyBrandLawsToPrompt } from "../brand-laws";

describe("STAFFD Brand Laws", () => {
  describe("Zero-Confusion Output Rule", () => {
    it("contains Zero-Confusion Output Rule header", () => {
      expect(STAFFD_BRAND_LAWS).toContain("Zero-Confusion Output Rule");
    });

    it("contains all four required elements", () => {
      expect(STAFFD_BRAND_LAWS).toContain("Exact location");
      expect(STAFFD_BRAND_LAWS).toContain("Exact text/values");
      expect(STAFFD_BRAND_LAWS).toContain("Verification step");
      expect(STAFFD_BRAND_LAWS).toContain("Rollback step");
    });

    it("includes the five-minute test", () => {
      expect(STAFFD_BRAND_LAWS).toContain("next five minutes");
    });

    it("lists common incomplete endings to watch for", () => {
      expect(STAFFD_BRAND_LAWS).toContain("Update your meta tags");
      expect(STAFFD_BRAND_LAWS).toContain("Optimize your headlines");
      expect(STAFFD_BRAND_LAWS).toContain("Reach out to your");
    });
  });

  describe("No-External-Execution Rule", () => {
    it("contains No-External-Execution header", () => {
      expect(STAFFD_BRAND_LAWS).toContain("STAFFD never executes externally");
    });

    it("explicitly forbids silent writes to external systems", () => {
      expect(STAFFD_BRAND_LAWS).toContain("explicit user click");
      expect(STAFFD_BRAND_LAWS).toContain("non-negotiable");
    });
  });

  describe("applyBrandLawsToPrompt function", () => {
    it("prepends brand laws to a sample agent system prompt", () => {
      const samplePrompt = "You are a test agent.";
      const result = applyBrandLawsToPrompt(samplePrompt);
      expect(result).toContain("Zero-Confusion Output Rule");
      expect(result).toContain("STAFFD never executes externally");
      expect(result).toContain("You are a test agent.");
    });

    it("preserves the original prompt content", () => {
      const samplePrompt = "Original content here";
      const result = applyBrandLawsToPrompt(samplePrompt);
      expect(result).toContain("Original content here");
    });

    it("handles empty string gracefully", () => {
      const result = applyBrandLawsToPrompt("");
      expect(result).toContain("STAFFD");
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles null via nullish coalescing", () => {
      const result = applyBrandLawsToPrompt(null);
      expect(result).toContain("STAFFD");
      // Should not throw; null treated as empty string per nullish coalescing
    });

    it("handles undefined via nullish coalescing", () => {
      const result = applyBrandLawsToPrompt(undefined);
      expect(result).toContain("STAFFD");
    });
  });
});
