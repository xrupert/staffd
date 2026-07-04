/**
 * Wire-the-loop — follow-on suggestion generation after workflow completion.
 * Fail-open contract: any LLM failure, junk output, or throw returns [] —
 * suggestions are a courtesy, never a new way completion can fail.
 */

import { describe, it, expect, vi } from "vitest";

// follow-on.ts imports the guarded callLLM whose module constructs the
// Anthropic SDK client at load. Every test here injects its own llm fn,
// so mock the module away entirely.
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: vi.fn() }));

import {
  parseFollowOns,
  extractJsonArray,
  generateFollowOnSuggestions,
} from "../../app/api/_lib/orchestrator/follow-on";
import type { callLLM } from "../../app/api/_lib/orchestrator/llm";

const okLLM = (text: string) =>
  vi.fn(async () => ({
    ok: true as const, text, attempts: 1, latencyMs: 5, tokensIn: 10, tokensOut: 10, model: "m", costUsd: 0,
  })) as unknown as typeof callLLM;

describe("parseFollowOns", () => {
  it("keeps valid {title, goal} pairs, capped at 3, bounded lengths", () => {
    const raw = [
      { title: "A/B the campaign", goal: "Create an A/B variant of the launch email" },
      { title: "x".repeat(200), goal: "y".repeat(500) },
      { title: "CRM entries", goal: "Log responders as leads in the CRM" },
      { title: "Fourth", goal: "Should be dropped" },
    ];
    const out = parseFollowOns(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ title: "A/B the campaign", goal: "Create an A/B variant of the launch email" });
    expect(out[1]!.title.length).toBeLessThanOrEqual(80);
    expect(out[1]!.goal.length).toBeLessThanOrEqual(300);
  });

  it("drops junk: non-arrays, non-objects, missing fields", () => {
    expect(parseFollowOns("not an array")).toEqual([]);
    expect(parseFollowOns([null, 42, { title: "no goal" }, { goal: "no title" }])).toEqual([]);
  });
});

describe("extractJsonArray", () => {
  it("pulls the array out of code fences and surrounding prose", () => {
    const text = 'Here you go:\n```json\n[{"title":"t","goal":"g"}]\n```';
    expect(extractJsonArray(text)).toEqual([{ title: "t", goal: "g" }]);
  });
  it("returns null when there is no parseable array", () => {
    expect(extractJsonArray("no array here")).toBeNull();
    expect(extractJsonArray("[broken json")).toBeNull();
  });
});

describe("generateFollowOnSuggestions", () => {
  it("returns parsed suggestions from a clean LLM response", async () => {
    const llm = okLLM('[{"title":"Post about it","goal":"Draft social posts announcing the launch"}]');
    const out = await generateFollowOnSuggestions("Launch the product", ["Draft copy", "Make visual"], llm);
    expect(out).toEqual([{ title: "Post about it", goal: "Draft social posts announcing the launch" }]);
  });

  it("fails OPEN — LLM failure returns []", async () => {
    const llm = vi.fn(async () => ({
      ok: false as const, fallback: "upstream_error" as const, attempts: 1, latencyMs: 5, tokensIn: 0, tokensOut: 0, model: "m", costUsd: 0,
    })) as unknown as typeof callLLM;
    expect(await generateFollowOnSuggestions("Goal", [], llm)).toEqual([]);
  });

  it("fails OPEN — LLM throw returns []", async () => {
    const llm = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof callLLM;
    expect(await generateFollowOnSuggestions("Goal", [], llm)).toEqual([]);
  });

  it("fails OPEN — prose-only response returns []", async () => {
    const llm = okLLM("I think you should consider several things, none of which are JSON.");
    expect(await generateFollowOnSuggestions("Goal", [], llm)).toEqual([]);
  });

  it("empty goal short-circuits without calling the LLM", async () => {
    const llm = okLLM("[]");
    expect(await generateFollowOnSuggestions("   ", [], llm)).toEqual([]);
    expect(llm).not.toHaveBeenCalled();
  });
});
