/**
 * PR-Tranche-2.6.5 (W38 + W39) — isAgentAskingQuestion predicate tests.
 *
 * Drives two UX behaviors:
 *   - W38: skip handoff fetch when agent is awaiting an answer
 *   - W39: switch input placeholder to "Type your reply…" + auto-focus
 *
 * Single source of truth — both surfaces share the same predicate.
 */

import { describe, it, expect } from "vitest";
import { isAgentAskingQuestion } from "../../app/components/CommandCenter";

describe("isAgentAskingQuestion (W38/W39 predicate)", () => {
  it("returns true for text ending with a question mark", () => {
    expect(isAgentAskingQuestion("What platform are you targeting?")).toBe(true);
  });

  it("returns true for multi-paragraph text ending with a question", () => {
    expect(
      isAgentAskingQuestion(
        "Here are some thoughts on your campaign:\n\n" +
          "We could focus on awareness or conversion.\n\n" +
          "Which would you prioritize?",
      ),
    ).toBe(true);
  });

  it("returns true when the trailing 200 chars contain an interrogative phrase", () => {
    const lead = "Here is a detailed analysis. ".repeat(20);
    const text = lead + "Tell me which audience to prioritize and I'll tighten the plan.";
    expect(isAgentAskingQuestion(text)).toBe(true);
  });

  it("returns false for completed declarative deliverables", () => {
    const text =
      "# LinkedIn Post Draft\n\n" +
      "Excited to announce Earthly Matters' new interior painting service. " +
      "Premium finishes, eco-friendly paints, and a 5-star guarantee.\n\n" +
      "Book your free consultation today.";
    expect(isAgentAskingQuestion(text)).toBe(false);
  });

  it("returns false for empty or whitespace-only input", () => {
    expect(isAgentAskingQuestion("")).toBe(false);
    expect(isAgentAskingQuestion("   ")).toBe(false);
    // @ts-expect-error — defensive: handles undefined/null
    expect(isAgentAskingQuestion(undefined)).toBe(false);
  });

  it("does NOT false-positive on body-internal rhetorical questions when the END is declarative", () => {
    const text =
      "Should you target Gen Z? Probably yes. Should you also target millennials? Yes. " +
      "Here is the campaign plan: Phase 1 launches Monday with paid social, Phase 2 layers in influencer outreach Wednesday, " +
      "Phase 3 ships the landing page Friday. Total budget: $5,000. Expected reach: 100,000 impressions. " +
      "Ready to execute on your approval. The campaign window opens next week. All assets locked in production. " +
      "Final deliverable will be the post-launch performance report on day 14. End of plan.";
    // Tail is purely declarative — predicate should return false even though
    // there are body-internal "Should you..." phrasings
    expect(isAgentAskingQuestion(text)).toBe(false);
  });

  it("returns true for 'Would you like me to' style soft-question phrasing", () => {
    expect(
      isAgentAskingQuestion("I drafted the first half. Would you like me to continue with the second?"),
    ).toBe(true);
  });

  it("returns true for 'Can you tell me' tail phrasings", () => {
    expect(
      isAgentAskingQuestion("To finalize this, can you tell me which CTA you prefer."),
    ).toBe(true);
  });
});
