/**
 * W58.3 Tests 5 + 8 — /api/packs industry bridging + informational shape.
 *
 * SA Decision 7: the route loads businesses.industry via admin token
 * (single read) and passes vaultIndustry to resolveDepartments, so the
 * `active` flags reflect D-19 bridged state. The response carries zero
 * purchase semantics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const pbMocks = vi.hoisted(() => ({
  businessesReads: 0,
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
      pbMocks.businessesReads += 1;
      return pbMocks.industry === undefined ? null : { industry: pbMocks.industry };
    }
    if (collection === "subscriptions") return pbMocks.sub;
    return null;
  },
}));

vi.mock("../../app/api/_lib/comp", () => ({
  isCompedUser: async () => pbMocks.comped,
}));

import { GET } from "../../app/api/packs/route";

beforeEach(() => {
  pbMocks.businessesReads = 0;
  pbMocks.industry = "Italian restaurant";
  pbMocks.sub = { id: "sub_1", plan: "growth", industry_packs: [] };
  pbMocks.comped = false;
});

describe("/api/packs (W58.3 bridging + shape)", () => {
  it("bridged restaurant user: restaurants active, other 7 inactive, single businesses read (Tests 5+8)", async () => {
    const res = await GET(new Request("https://test.local/api/packs?userId=user-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packs: Array<{ id: string; active: boolean }> };

    const restaurants = body.packs.find((p) => p.id === "restaurants");
    expect(restaurants?.active).toBe(true);
    const others = body.packs.filter((p) => p.id !== "restaurants");
    expect(others).toHaveLength(7);
    expect(others.every((p) => p.active === false)).toBe(true);

    // SA Decision 7 — exactly one businesses-collection read per request.
    expect(pbMocks.businessesReads).toBe(1);
  });

  it("response carries no purchase semantics", async () => {
    const res = await GET(new Request("https://test.local/api/packs?userId=user-1"));
    const body = (await res.json()) as { packs: Array<Record<string, unknown>> };
    for (const pack of body.packs) {
      expect(Object.keys(pack).sort()).toEqual(
        ["active", "agentCount", "departments", "description", "icon", "id", "name"]
      );
    }
    expect(JSON.stringify(body)).not.toMatch(/price|purchasable|upsell|checkout/i);
  });

  it("no-industry user: zero packs active, graceful", async () => {
    pbMocks.industry = undefined;
    const res = await GET(new Request("https://test.local/api/packs?userId=user-1"));
    const body = (await res.json()) as { packs: Array<{ active: boolean }>; activePackIds: string[] };
    expect(body.activePackIds).toEqual([]);
    expect(body.packs.every((p) => !p.active)).toBe(true);
  });

  it("comp user: all 8 active regardless of industry", async () => {
    pbMocks.comped = true;
    pbMocks.industry = undefined;
    const res = await GET(new Request("https://test.local/api/packs?userId=user-1"));
    const body = (await res.json()) as { packs: Array<{ active: boolean }> };
    expect(body.packs).toHaveLength(8);
    expect(body.packs.every((p) => p.active)).toBe(true);
  });
});
