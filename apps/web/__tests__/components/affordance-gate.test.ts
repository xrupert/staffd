/**
 * Affordance gate fix — shouldFetchAffordances.
 *
 * Bug: specialists often finish a deliverable and then offer to do more
 * ("…want me to build the full sequence?"). That trailing question tripped
 * isAgentAskingQuestion(), which suppressed the action affordances — so a
 * finished cold email never got its "Send as campaign / Add to CRM" buttons.
 *
 * Fix: a SHORT response that is essentially just a clarifying question still
 * skips the handoff fetch (the agent needs info before it can work), but a
 * substantial deliverable shows affordances regardless of a trailing offer.
 */

import { describe, it, expect } from "vitest";
import { shouldFetchAffordances } from "../../app/components/CommandCenter";

const COLD_EMAIL = `Subject: Quick question about tenant move-outs

Hi [Name],

I'm looking at property managers in [City] because most are spending way too much on junk removal after tenant turnover — either contractors dragging their feet or tenants leaving behind 3 dumpsters worth of stuff.

We handle post-move cleanouts in 24-48 hours flat. No scheduling games, flat per-unit pricing, and we haul everything that gets left behind so your turnaround time actually shrinks instead of getting longer.

Two questions:
1. How many units do you turn over per month?
2. What's your current process for handling junk after a lease ends?

Happy to share some numbers on what other PMs in your market are saving.

[Your name]

Ready to build a full sequence (email + LinkedIn + follow-ups) or refine the angle?`;

describe("shouldFetchAffordances (gate fix)", () => {
  it("fires for a finished deliverable that ends with an offer question", () => {
    expect(shouldFetchAffordances(COLD_EMAIL)).toBe(true);
  });

  it("does NOT fire for a short, pure clarifying question (no work done yet)", () => {
    expect(shouldFetchAffordances("Which platform are you targeting — Instagram or LinkedIn?")).toBe(false);
  });

  it("does NOT fire for empty or trivially short output", () => {
    expect(shouldFetchAffordances("")).toBe(false);
    expect(shouldFetchAffordances("Done.")).toBe(false);
  });

  it("fires for a substantial deliverable with no trailing question", () => {
    const doc = "Executive summary. ".repeat(60); // ~1100 chars, no question
    expect(shouldFetchAffordances(doc)).toBe(true);
  });

  it("does NOT fire for a medium clarifying response that lists options but does no work", () => {
    const clarify =
      "I can take this a couple of ways. Are you asking me to: 1. Draft a listing promotion, or 2. Create marketing copy for the service? Let me know which and I'll get started.";
    expect(shouldFetchAffordances(clarify)).toBe(false);
  });
});
