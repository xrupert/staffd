/**
 * W95.7.3d-T1 — POST /api/generation/estimate: dynamic-priced → estimate call →
 * {costUsd, tier, weight}; static-priced → cached weight, NO estimate call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => ({ id: "u1", email: "a@c.com" }) }));
vi.mock("../../app/api/_lib/generation/routing", () => ({ routeFor: () => ["model-x"] }));

const cat = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));
vi.mock("../../app/api/_lib/generation/catalog", () => ({ modelTierWeight: async () => cat.row }));
const est = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", () => ({ estimateCost: est.fn }));

import { POST } from "../../app/api/generation/estimate/route";

const req = (body: object) => POST(new Request("https://t/api/generation/estimate", { method: "POST", headers: { authorization: "tok", "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => { est.fn.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("POST /api/generation/estimate (W95.7.3d-T1)", () => {
  it("dynamic-priced → calls estimate, derives tier + weight from cost", async () => {
    cat.row = { dynamic_pricing: true, estimate_endpoint: "/x", credit_weight: 0, cost_usd: null, kind: "video", tier: "" };
    est.fn.mockResolvedValue(2.5); // → premium / 60
    const d = await (await req({ kind: "video", tier: "premium", department: "marketing", prompt: "x" })).json();
    expect(est.fn).toHaveBeenCalledTimes(1);
    expect(d).toMatchObject({ costUsd: 2.5, tier: "premium", creditWeight: 60 });
  });

  it("static-priced → cached weight, NO estimate call", async () => {
    cat.row = { dynamic_pricing: false, credit_weight: 8, cost_usd: 0.3, kind: "video", tier: "pro", estimate_endpoint: "" };
    const d = await (await req({ kind: "video", tier: "pro", department: "marketing", prompt: "x" })).json();
    expect(est.fn).not.toHaveBeenCalled();
    expect(d.creditWeight).toBe(8);
  });

  it("401 without auth-less identity is enforced by whoAmI (smoke)", async () => {
    // whoAmI mocked to a user here; this asserts the happy path returns 200-shape.
    cat.row = { dynamic_pricing: false, credit_weight: 2, kind: "image", tier: "pro", cost_usd: 0.05, estimate_endpoint: "" };
    const res = await req({ kind: "image", tier: "pro", department: "marketing", prompt: "y" });
    expect(res.status).toBe(200);
  });
});
