/**
 * W95.7.3d-T1 — routing: department defaults + ordered model lists, and the
 * C5 slug-drift validator (throws naming the offending slug).
 */

import { describe, it, expect } from "vitest";
import { routeFor, routeDefaultTier, allRoutingSlugs, validateRoutingSlugs } from "../../app/api/_lib/generation/routing";

describe("routeFor / defaults (W95.7.3d-T1)", () => {
  it("marketing video defaults to Pro with an ordered model list", () => {
    expect(routeDefaultTier("marketing", "video")).toBe("pro");
    const models = routeFor("marketing", "video", "pro");
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });
  it("an unknown department falls back to the shared default models + pro default", () => {
    expect(routeDefaultTier("nope-dept", "image")).toBe("pro");
    expect(routeFor("nope-dept", "image", "quick").length).toBeGreaterThan(0);
  });
});

describe("validateRoutingSlugs (C5)", () => {
  it("passes when every routing slug is in the catalog", () => {
    const catalog = new Set(allRoutingSlugs());
    expect(() => validateRoutingSlugs(catalog)).not.toThrow();
  });
  it("throws and names the offending slug when one is absent (catches drift)", () => {
    const all = allRoutingSlugs();
    const catalog = new Set(all.slice(1)); // drop the first slug
    expect(() => validateRoutingSlugs(catalog)).toThrow(new RegExp(all[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
