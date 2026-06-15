/**
 * Routing-quality fix — routablePacksFor.
 *
 * Comped/super-admin accounts have ALL packs active (trial.ts). Without this
 * gate, every vertical agent competes in auto-routing, so an unrelated
 * vertical (e.g. a real-estate "Listing Promoter") can win an out-of-vertical
 * task (e.g. a junk-removal proposal). Auto-routing must only offer the pack
 * matching the user's RESOLVED industry — generic agents otherwise. (Explicit
 * pack access via dept pages is unaffected; this narrows auto-route only.)
 */

import { describe, it, expect, vi } from "vitest";

// route.ts transitively imports llm.ts, which constructs `new Anthropic()` at
// module load — stub the SDK so the import succeeds without an API key (this
// pure helper never touches it). Mirrors the other orchestrator tests.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = { create: async () => ({}), stream: () => ({}) };
  },
}));

import { routablePacksFor } from "../../app/api/_lib/orchestrator/handlers/route";

const ALL = ["law", "real-estate", "restaurants", "coaches", "trades", "salons", "agencies", "consultants"];

describe("routablePacksFor (auto-route vertical gate)", () => {
  it("no resolved industry → no pack agents in the auto-route pool (even when all packs active)", () => {
    expect(routablePacksFor(null, ALL)).toEqual([]);
    expect(routablePacksFor(undefined, ALL)).toEqual([]);
  });

  it("resolved industry that is active → only that pack", () => {
    expect(routablePacksFor("real-estate", ALL)).toEqual(["real-estate"]);
  });

  it("resolved industry NOT among active packs → no packs (can't route to an unowned vertical)", () => {
    expect(routablePacksFor("real-estate", ["trades"])).toEqual([]);
  });

  it("the comped junk-removal case: all packs active, no industry → generic-only", () => {
    expect(routablePacksFor(null, ALL)).toEqual([]);
  });

  it("empty active packs → empty regardless of industry", () => {
    expect(routablePacksFor("real-estate", [])).toEqual([]);
  });
});
