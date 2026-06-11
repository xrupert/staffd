/**
 * W58.0.1 — Industry bridging at trial.ts (D-19 gap closure).
 *
 * Pins the activePacks priority order in resolveDepartments:
 *   1. Comp → all packs (Hotfix E1, unchanged)
 *   2. Explicit subscription industry_packs → honored (purchased packs)
 *   3. Industry bridging → vaultIndustry resolves to one auto-activated pack
 *   4. No match / no industry supplied → empty (pre-bridging behavior)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const pbMocks = vi.hoisted(() => ({
  sub: null as Record<string, unknown> | null,
  comped: false,
}));

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t }),
  pbFirst: async () => pbMocks.sub,
}));

vi.mock("../../app/api/_lib/comp", () => ({
  isCompedUser: async () => pbMocks.comped,
}));

import { resolveDepartments } from "../../app/api/_lib/trial";

beforeEach(() => {
  pbMocks.sub = { id: "sub_1", plan: "growth", industry_packs: [] };
  pbMocks.comped = false;
});

describe("resolveDepartments — W58.0.1 industry bridging", () => {
  it("bridges a non-purchaser's matching industry to one auto-activated pack", async () => {
    const state = await resolveDepartments("user1", { vaultIndustry: "Italian restaurant" });
    expect(state.activePacks).toEqual(["restaurants"]);
  });

  it("produces empty activePacks when the industry has no pack match", async () => {
    const state = await resolveDepartments("user1", { vaultIndustry: "manufacturing" });
    expect(state.activePacks).toEqual([]);
  });

  it("produces empty activePacks when no vaultIndustry is supplied (pre-bridging callers)", async () => {
    const state = await resolveDepartments("user1");
    expect(state.activePacks).toEqual([]);
  });

  it("explicit subscription pack ownership beats industry resolution", async () => {
    pbMocks.sub = { id: "sub_1", plan: "growth", industry_packs: ["law"] };
    const state = await resolveDepartments("user1", { vaultIndustry: "Italian restaurant" });
    expect(state.activePacks).toEqual(["law"]);
  });

  it("comp override beats both — all 8 packs regardless of industry or ownership", async () => {
    pbMocks.comped = true;
    pbMocks.sub = { id: "sub_1", plan: "starter", industry_packs: ["law"] };
    const state = await resolveDepartments("user1", { vaultIndustry: "Italian restaurant" });
    expect(state.activePacks).toHaveLength(8);
    expect(state.activePacks).toContain("restaurants");
    expect(state.activePacks).toContain("law");
  });

  it("bridging also fires when the subscription record is missing entirely", async () => {
    pbMocks.sub = null;
    const state = await resolveDepartments("user1", { vaultIndustry: "hair salon and day spa" });
    expect(state.activePacks).toEqual(["salons"]);
  });
});
