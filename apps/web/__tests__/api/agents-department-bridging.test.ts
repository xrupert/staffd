/**
 * W58.2 Tests 1 + 7 — roster drawer bridging (/api/agents/[department]).
 *
 * A non-comp user with a matching business industry and no purchased packs
 * sees bridged pack specialists in the department roster. A user with no
 * business profile degrades gracefully to the generic roster.
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

import { GET } from "../../app/api/agents/[department]/route";

function rosterRequest(dept: string, userId?: string) {
  const url = `https://test.local/api/agents/${dept}${userId ? `?userId=${userId}` : ""}`;
  return [new Request(url), { params: Promise.resolve({ department: dept }) }] as const;
}

beforeEach(() => {
  pbMocks.industry = "Italian restaurant";
  pbMocks.sub = { id: "sub_1", plan: "growth", industry_packs: [] };
  pbMocks.comped = false;
});

describe("/api/agents/[department] — W58.2 bridging", () => {
  it("bridged restaurant user sees the restaurants pack specialist in the operations roster (Test 1)", async () => {
    const [req, ctx] = rosterRequest("operations", "user-1");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const agents = (await res.json()) as Array<{ id: string; pack: string | null }>;

    expect(agents.some((a) => a.id === "pack-restaurants-operations-shift-scheduler")).toBe(true);
    // Only the bridged pack joins — no other pack agents leak in.
    expect(agents.filter((a) => a.pack && a.pack !== "restaurants")).toHaveLength(0);
  });

  it("no business profile → generic roster, no crash (Test 7)", async () => {
    pbMocks.industry = undefined;
    const [req, ctx] = rosterRequest("operations", "user-1");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const agents = (await res.json()) as Array<{ pack: string | null }>;
    expect(agents.length).toBe(12); // generic operations roster
    expect(agents.every((a) => a.pack === null)).toBe(true);
  });

  it("no userId → generic roster (public catalog path unchanged)", async () => {
    const [req, ctx] = rosterRequest("operations");
    const res = await GET(req, ctx);
    const agents = (await res.json()) as Array<{ pack: string | null }>;
    expect(agents.every((a) => a.pack === null)).toBe(true);
  });
});
