/**
 * T1-3 (W70.2 fix) — condenseForOrchestrator routing-history contract.
 *
 * ROOT CAUSE this guards: on follow-up turns the Command Center sent the
 * routing LLM (Haiku, 512-token cap) a conversation history containing
 *   (a) coordinator routing-transparency stubs ("Marketing → Content
 *       Creator is on it…") — pure UI affordances that read as an explicit
 *       "active department = Marketing" anchor, and
 *   (b) full prior deliverables (600+ words) that dominate the context
 *       window.
 * Both anchored the router to the PREVIOUS department, so turns 2/3
 * mis-routed (the W70.2 regression).
 *
 * condenseForOrchestrator removes the anchors while preserving the real
 * routing signal (user messages) and light context (a deliverable excerpt).
 */

import { describe, it, expect } from "vitest";
import { condenseForOrchestrator } from "../../app/components/CommandCenter";

type M = { role: "user" | "assistant"; content: string; isOutput?: boolean };

describe("condenseForOrchestrator (W70.2 fix — routing-history contract)", () => {
  it("drops coordinator/status stubs (assistant messages that are not deliverables)", () => {
    const messages: M[] = [
      { role: "user", content: "write a marketing blog post" },
      { role: "assistant", content: "Marketing → Content Creator is on it…" },
      { role: "assistant", content: "# Blog Post\n\nGreat content here.", isOutput: true },
      { role: "user", content: "draft an NDA for a contractor" },
    ];
    const out = condenseForOrchestrator(messages);
    // The coordinator stub must not survive — it is the strongest anchor.
    expect(out.some((m) => m.content.includes("is on it"))).toBe(false);
  });

  it("keeps user messages verbatim", () => {
    const messages: M[] = [
      { role: "user", content: "write a marketing blog post" },
      { role: "assistant", content: "X → Y is on it…" },
      { role: "user", content: "draft an NDA for a contractor" },
    ];
    const out = condenseForOrchestrator(messages);
    const users = out.filter((m) => m.role === "user").map((m) => m.content);
    expect(users).toEqual(["write a marketing blog post", "draft an NDA for a contractor"]);
  });

  it("truncates a long deliverable to a short excerpt with an ellipsis", () => {
    const long = "A".repeat(2000);
    const messages: M[] = [
      { role: "user", content: "write something long" },
      { role: "assistant", content: long, isOutput: true },
    ];
    const out = condenseForOrchestrator(messages, { excerptChars: 240 });
    const deliverable = out.find((m) => m.role === "assistant");
    expect(deliverable).toBeDefined();
    expect(deliverable!.content.length).toBeLessThanOrEqual(241); // 240 + ellipsis char
    expect(deliverable!.content.endsWith("…")).toBe(true);
  });

  it("keeps a short deliverable untouched (no ellipsis added)", () => {
    const messages: M[] = [
      { role: "user", content: "write a tagline" },
      { role: "assistant", content: "Just do it.", isOutput: true },
    ];
    const out = condenseForOrchestrator(messages, { excerptChars: 240 });
    const deliverable = out.find((m) => m.role === "assistant");
    expect(deliverable!.content).toBe("Just do it.");
  });

  it("REGRESSION: latest user request dominates — wrong-dept anchors removed", () => {
    const marketingDoc = "# 10 SEO Tips\n\n" + "Marketing marketing marketing. ".repeat(80);
    const messages: M[] = [
      { role: "user", content: "write a marketing blog post about SEO" },
      { role: "assistant", content: "Marketing → SEO Specialist is on it…" },
      { role: "assistant", content: marketingDoc, isOutput: true },
      { role: "user", content: "now draft an NDA for a new contractor" },
    ];
    const out = condenseForOrchestrator(messages, { excerptChars: 240 });
    // No "is on it" anchor.
    expect(out.some((m) => m.content.includes("is on it"))).toBe(false);
    // The marketing deliverable no longer dominates (truncated).
    const totalAssistantChars = out
      .filter((m) => m.role === "assistant")
      .reduce((n, m) => n + m.content.length, 0);
    expect(totalAssistantChars).toBeLessThan(marketingDoc.length);
    // The latest user message is present and intact.
    expect(out[out.length - 1]).toEqual({ role: "user", content: "now draft an NDA for a new contractor" });
  });

  it("strips READY/EXECUTE markers from a retained deliverable", () => {
    const messages: M[] = [
      { role: "user", content: "route me" },
      { role: "assistant", content: "Here it is.\nREADY:{\"department\":\"sales\"}", isOutput: true },
    ];
    const out = condenseForOrchestrator(messages);
    const deliverable = out.find((m) => m.role === "assistant");
    expect(deliverable!.content).not.toContain("READY:");
    expect(deliverable!.content).toContain("Here it is.");
  });

  it("filters out messages that become empty after cleaning", () => {
    const messages: M[] = [
      { role: "user", content: "do a thing" },
      { role: "assistant", content: "READY:{\"department\":\"sales\"}", isOutput: true },
      { role: "assistant", content: "   ", isOutput: true },
    ];
    const out = condenseForOrchestrator(messages);
    expect(out.every((m) => m.content.trim().length > 0)).toBe(true);
    expect(out).toHaveLength(1);
  });
});
