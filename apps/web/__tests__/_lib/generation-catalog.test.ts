/**
 * W95.7.3d-T1 — catalog sync: classify static-priced models into tier/weight,
 * leave dynamic-priced with cost_usd=null, and degrade gracefully when Muapi
 * is unreachable (existing rows untouched).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "tok", pbUrl: () => "https://pb.test",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }), pbEscape: (s: string) => s,
}));

import { syncMuapiCatalog } from "../../app/api/_lib/generation/catalog";

const writes: { method: string; body: Record<string, unknown> }[] = [];
function stub(modelsResponse: () => unknown | Promise<unknown>) {
  writes.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/api/v1/models")) return { ok: true, status: 200, json: async () => modelsResponse() };
    if (url.includes("/generation_models/records") && method === "GET") return { ok: true, json: async () => ({ items: [] }) };
    if (url.includes("/generation_models/records")) { writes.push({ method, body: JSON.parse(init!.body as string) }); return { ok: true, json: async () => ({ id: "row1" }) }; }
    return { ok: true, json: async () => ({}) };
  }));
}

beforeEach(() => {});
afterEach(() => vi.unstubAllGlobals());

describe("syncMuapiCatalog (W95.7.3d-T1)", () => {
  it("classifies static-priced models and leaves dynamic cost_usd null", async () => {
    stub(() => [
      { name: "flux-static", category: "Text-to-Image", cost: 0.02, dynamic_pricing: false },           // image quick
      { name: "vid-static", category: "Image-to-Video", cost: 2.5, dynamic_pricing: false },             // video premium
      { name: "vid-dyn", category: "Image-to-Video", cost: 0, dynamic_pricing: true, estimate_endpoint: "/x" }, // dynamic
    ]);
    const r = await syncMuapiCatalog();
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(3);
    expect(r.upserted).toBe(3);
    const img = writes.find((w) => w.body.name === "flux-static")!;
    expect(img.body).toMatchObject({ kind: "image", tier: "quick", credit_weight: 1, cost_usd: 0.02 });
    const vid = writes.find((w) => w.body.name === "vid-static")!;
    expect(vid.body).toMatchObject({ kind: "video", tier: "premium", credit_weight: 60 });
    const dyn = writes.find((w) => w.body.name === "vid-dyn")!;
    expect(dyn.body.cost_usd).toBeNull();
    expect(dyn.body.dynamic_pricing).toBe(true);
  });

  it("Muapi unreachable → exits cleanly, no upserts, cache untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/v1/models")) throw new Error("ECONNREFUSED");
      return { ok: true, json: async () => ({ items: [] }) };
    }));
    const r = await syncMuapiCatalog();
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe("unreachable");
    expect(r.upserted).toBe(0);
  });
});
