/**
 * W92.1 — VERIFICATION (read-only): when a user's industry resolves to a pack
 * and that pack is active (comp/Agency = all packs active), the orchestrator's
 * candidate roster includes that pack's specialists.
 *
 * Mirrors the real flow in orchestrator/handlers/route.ts:
 *   userIndustry = resolveIndustryToPackId(<vault industry>)
 *   routablePacks = routablePacksFor(userIndustry, activePacks)
 *   getDepartmentAgents(dept, { activePacks: routablePacks })  ← candidate set
 */

import { describe, it, expect, vi } from "vitest";

// route.ts transitively imports llm.ts, which constructs `new Anthropic()` at
// module load — stub the SDK so the import succeeds without an API key (these
// pure helpers never touch it). Mirrors the other orchestrator tests.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = { create: async () => ({}), stream: () => ({}) };
  },
}));

import { resolveIndustryToPackId, getDepartmentAgents, PACK_IDS } from "@staffd/agents";
import { routablePacksFor } from "../../app/api/_lib/orchestrator/handlers/route";

describe("pack-bias routing (W92.1 verification)", () => {
  it("'consulting' industry resolves to the consultants pack", () => {
    expect(resolveIndustryToPackId("consulting")).toBe("consultants");
    expect(resolveIndustryToPackId("consultants")).toBe("consultants");
  });

  it("an active matched pack is routable; an inactive one is not", () => {
    // comp/Agency: every pack active → the user's pack is offered to auto-route
    expect(routablePacksFor("consultants", PACK_IDS)).toEqual(["consultants"]);
    // pack not active → not offered (keeps unrelated verticals out)
    expect(routablePacksFor("consultants", [])).toEqual([]);
  });

  it("the candidate roster INCLUDES consultants-pack specialists when the pack is routable", () => {
    const userIndustry = resolveIndustryToPackId("consulting"); // "consultants"
    const routablePacks = routablePacksFor(userIndustry, PACK_IDS);

    const withPack = getDepartmentAgents("marketing", { activePacks: routablePacks });
    const base = getDepartmentAgents("marketing"); // no packs

    const packSpecialists = withPack.filter((a) => a.pack === "consultants");
    expect(packSpecialists.length).toBeGreaterThan(0);
    // and they are genuinely additive — not present in the generic-only roster
    expect(base.some((a) => a.pack === "consultants")).toBe(false);
    expect(withPack.length).toBeGreaterThan(base.length);
  });
});
