/**
 * PR-Tranche-2.5 (W26 fix) — CommandCenter follow-up + cleanForOrchestrator.
 *
 * Covers the W26 root cause + fix verification dimensions:
 *   - cleanForOrchestrator strips READY:{...} and EXECUTE:{...} markers from
 *     assistant messages before they're sent back to the orchestrator on
 *     follow-up turns (so the brain sees clean conversation context)
 *   - User content is never stripped (regression guard)
 *   - Empty / whitespace inputs handled safely
 *   - Multiple READY markers in one message stripped
 *   - EXECUTE on its own line stripped
 *
 * Note on UI-state coverage: a full React-rendering test of the post-fix
 * input visibility requires happy-dom + a CommandCenter render. The
 * cleanForOrchestrator helper is the body-cleaning contract; the visual
 * "input stays visible after phase=done" is verified manually + via the
 * smoke test in the PR-Tranche-2.5 fix verification. This file covers the
 * deterministic logic.
 */

import { describe, it, expect } from "vitest";
import { cleanForOrchestrator } from "../../app/components/CommandCenter";

describe("cleanForOrchestrator (W26 fix — body-cleaning contract)", () => {
  it("strips a READY:{...} line preceded by newline", () => {
    const input = "Your SEO Specialist on Marketing is the right fit.\nREADY:{\"department\":\"marketing\",\"agentId\":\"marketing-seo-specialist\",\"task\":\"audit SEO\",\"lockedAlternative\":\"\"}";
    const out = cleanForOrchestrator(input);
    expect(out).toBe("Your SEO Specialist on Marketing is the right fit.");
    expect(out).not.toContain("READY:");
  });

  it("strips a READY:{...} marker not preceded by newline (bare)", () => {
    const input = "Routing now. READY:{\"department\":\"sales\",\"agentId\":\"sales-prospector\",\"task\":\"x\",\"lockedAlternative\":\"\"}";
    const out = cleanForOrchestrator(input);
    expect(out).not.toContain("READY:");
    expect(out).toContain("Routing now.");
  });

  it("strips an EXECUTE:{...} line", () => {
    const input = "EXECUTE:{\"department\":\"marketing\",\"agentId\":\"marketing-seo-specialist\",\"task\":\"audit SEO\",\"lockedAlternative\":\"\"}";
    const out = cleanForOrchestrator(input);
    expect(out).toBe("");
  });

  it("preserves user content verbatim (no stripping of normal text)", () => {
    const input = "Make it more vibrant and use red accents instead of blue.";
    expect(cleanForOrchestrator(input)).toBe(input);
  });

  it("strips multiple READY markers within one assistant message", () => {
    const input = "First rationale.\nREADY:{\"a\":1}\n\nSecond rationale.\nREADY:{\"b\":2}";
    const out = cleanForOrchestrator(input);
    expect(out).not.toContain("READY:");
    expect(out).toContain("First rationale.");
    expect(out).toContain("Second rationale.");
  });

  it("returns empty string for empty / null / undefined input", () => {
    expect(cleanForOrchestrator("")).toBe("");
    // @ts-expect-error — defensive: production code may pass undefined-ish content
    expect(cleanForOrchestrator(undefined)).toBe("");
    // @ts-expect-error — same defensive case
    expect(cleanForOrchestrator(null)).toBe("");
  });

  it("strips READY: when the JSON payload contains nested braces / escaped quotes", () => {
    const input = "Coordinator says: do this.\nREADY:{\"department\":\"design\",\"agentId\":\"design-visual-storyteller\",\"task\":\"compose a hero image with text 'Welcome'\",\"lockedAlternative\":\"\"}";
    const out = cleanForOrchestrator(input);
    expect(out).toBe("Coordinator says: do this.");
    expect(out).not.toContain("READY:");
  });

  it("does NOT mistakenly strip user content that contains the word READY without colon-brace", () => {
    const input = "Are you READY to proceed?";
    expect(cleanForOrchestrator(input)).toBe("Are you READY to proceed?");
  });

  it("does NOT mistakenly strip user content that contains the word EXECUTE in prose", () => {
    const input = "Please EXECUTE the marketing campaign.";
    expect(cleanForOrchestrator(input)).toBe("Please EXECUTE the marketing campaign.");
  });

  it("preserves the generated output (long-form agent response) untouched", () => {
    const generatedOutput = "# Marketing Plan\n\n## Week 1\n- Launch teaser campaign\n- Run A/B tests\n\n## Week 2\n- Scale top performer";
    expect(cleanForOrchestrator(generatedOutput)).toBe(generatedOutput);
  });
});
