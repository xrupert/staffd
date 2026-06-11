/**
 * W59 Tests 5–9 — industry bridging helper (_lib/industry.ts).
 *
 * Precedence (Decision 3'): structured category wins; explicit "other"
 * beats free-text; free-text is the legacy fallback.
 * Lazy migration (Decision 4'): first touch writes the resolved category
 * (or "other"), idempotent, warn-logged on failure, never throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbFirst: async () => null,
}));

import {
  resolveBridgingIndustry,
  ensureIndustryCategory,
  bridgingIndustryFor,
} from "../../app/api/_lib/industry";

let patches: Array<{ url: string; body: Record<string, unknown> }>;
let patchOk: boolean;

beforeEach(() => {
  patches = [];
  patchOk = true;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === "PATCH") {
      patches.push({ url: String(input), body: JSON.parse(init.body ?? "{}") });
      return { ok: patchOk, status: patchOk ? 200 : 500, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  }));
});

describe("resolveBridgingIndustry (W59 Tests 5–7)", () => {
  it("structured category wins over unrelated free-text (Test 5)", () => {
    expect(resolveBridgingIndustry({ industry_category: "restaurants", industry: "something unrelated" }))
      .toBe("restaurants");
  });

  it("falls back to free-text when no category (Test 6)", () => {
    // The downstream resolver turns this into 'restaurants' via keywords.
    expect(resolveBridgingIndustry({ industry: "Italian restaurant" })).toBe("Italian restaurant");
  });

  it("explicit 'other' beats free-text — deliberate opt-out (Test 7)", () => {
    expect(resolveBridgingIndustry({ industry_category: "other", industry: "Italian restaurant" }))
      .toBeUndefined();
  });

  it("empty/null inputs resolve to undefined", () => {
    expect(resolveBridgingIndustry(null)).toBeUndefined();
    expect(resolveBridgingIndustry(undefined)).toBeUndefined();
    expect(resolveBridgingIndustry({ industry: "" })).toBeUndefined();
    expect(resolveBridgingIndustry({ industry_category: "  ", industry: "" })).toBeUndefined();
  });
});

describe("ensureIndustryCategory (W59 Tests 8–9)", () => {
  it("first touch writes the resolved category (Test 8)", async () => {
    await ensureIndustryCategory({ id: "biz_1", industry: "Italian bistro" });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain("/businesses/records/biz_1");
    expect(patches[0]!.body).toEqual({ industry_category: "restaurants" });
  });

  it("second touch is a no-op once category is set (Test 8 idempotency)", async () => {
    await ensureIndustryCategory({ id: "biz_1", industry: "Italian bistro", industry_category: "restaurants" });
    expect(patches).toHaveLength(0);
  });

  it("unresolvable free-text migrates to 'other' (Test 9)", async () => {
    await ensureIndustryCategory({ id: "biz_2", industry: "manufacturing" });
    expect(patches[0]!.body).toEqual({ industry_category: "other" });
  });

  it("empty industry also migrates to 'other' (the legacy skip-path cohort)", async () => {
    await ensureIndustryCategory({ id: "biz_3", industry: "" });
    expect(patches[0]!.body).toEqual({ industry_category: "other" });
  });

  it("failed PATCH logs at warn level and never throws (SA Q2 constraint)", async () => {
    patchOk = false;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(ensureIndustryCategory({ id: "biz_4", industry: "law firm" })).resolves.toBeUndefined();
    expect(warnSpy.mock.calls.flat().join("\n")).toContain("[W59-migration]");
    warnSpy.mockRestore();
  });

  it("no record id → no write", async () => {
    await ensureIndustryCategory({ industry: "law firm" });
    expect(patches).toHaveLength(0);
  });
});

describe("bridgingIndustryFor (the call-site one-liner)", () => {
  it("returns precedence value and fires migration in the background", async () => {
    const result = bridgingIndustryFor({ id: "biz_5", industry: "hair salon and day spa" });
    expect(result).toBe("hair salon and day spa");
    await new Promise((r) => setTimeout(r, 10)); // let the fire-and-forget land
    expect(patches[0]!.body).toEqual({ industry_category: "salons" });
  });
});
