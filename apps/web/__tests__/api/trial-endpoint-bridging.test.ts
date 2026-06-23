/**
 * W58.2 Test 2 + 7 — /api/trial reflects bridged activePacks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const pbMocks = vi.hoisted(() => ({
  industry: "Italian restaurant" as string | undefined,
  sub: { id: "sub_1", plan: "growth", industry_packs: [] } as Record<string, unknown> | null,
  comped: false,
}));

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t }),
  pbFirst: async (collection: string) => {
    if (collection === "businesses") {
      return pbMocks.industry === undefined ? null : { industry: pbMocks.industry };
    }
    if (collection === "subscriptions") return pbMocks.sub;
    return null;
  },
}));

vi.mock("../../app/api/_lib/comp", () => ({
  isCompedUser: async () => pbMocks.comped,
}));

// h6d — the route now derives userId from the authenticated session.
vi.mock("../../app/api/_lib/integrations/identity", () => ({
  whoAmI: async () => ({ id: "user-1", email: "u@test.local" }),
}));

import { GET } from "../../app/api/trial/route";

beforeEach(() => {
  pbMocks.industry = "Italian restaurant";
  pbMocks.sub = { id: "sub_1", plan: "growth", industry_packs: [] };
  pbMocks.comped = false;
});

describe("/api/trial — W58.2 bridging", () => {
  it("bridged restaurant user gets active_packs=['restaurants'] (Test 2)", async () => {
    const res = await GET(new Request("https://test.local/api/trial?userId=user-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active_packs: string[]; plan: string };
    expect(body.active_packs).toEqual(["restaurants"]);
    expect(body.plan).toBe("growth");
  });

  it("no business profile → empty active_packs, no crash (Test 7)", async () => {
    pbMocks.industry = undefined;
    const res = await GET(new Request("https://test.local/api/trial?userId=user-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active_packs: string[] };
    expect(body.active_packs).toEqual([]);
  });

  it("comp user → all 8 packs", async () => {
    pbMocks.comped = true;
    const res = await GET(new Request("https://test.local/api/trial?userId=user-1"));
    const body = (await res.json()) as { active_packs: string[] };
    expect(body.active_packs).toHaveLength(8);
  });
});
