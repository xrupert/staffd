/**
 * W95.7.3d-h2 — buildTierOptions is the single source of truth for the
 * pre-generation tier picker rows. Both GenerationTierModal (DepartmentRoom
 * overlay) and GenerationTierInline (CommandCenter conversation stream) render
 * from it, so the two surfaces can never drift in tier order, weights, labels,
 * or which tier is recommended (Standard #2 — single source of truth).
 */

import { describe, it, expect } from "vitest";
import { buildTierOptions } from "../../app/api/_lib/generation/tier-options";

describe("buildTierOptions", () => {
  it("returns three rows in quick→pro→premium order with the LOCKED weights", () => {
    const { rows } = buildTierOptions("marketing", "video");
    expect(rows.map((r) => r.tier)).toEqual(["quick", "pro", "premium"]);
    expect(rows.map((r) => r.weight)).toEqual([4, 8, 60]); // locked video weights
    const img = buildTierOptions("marketing", "image");
    expect(img.rows.map((r) => r.weight)).toEqual([1, 2, 4]); // locked image weights
  });

  it("marks exactly the department's default tier as recommended", () => {
    const { recommended, rows } = buildTierOptions("operations", "image");
    expect(recommended).toBe("quick"); // operations image default
    expect(rows.filter((r) => r.recommended).map((r) => r.tier)).toEqual(["quick"]);
  });

  it("falls back to pro for a department with no configured default", () => {
    expect(buildTierOptions("nonexistent-dept", "video").recommended).toBe("pro");
    const pro = buildTierOptions("nonexistent-dept", "video").rows.find((r) => r.recommended);
    expect(pro?.tier).toBe("pro");
  });

  it("carries customer-facing label + description for each row (no vendor names)", () => {
    const { rows } = buildTierOptions("marketing", "image");
    expect(rows.map((r) => r.label)).toEqual(["Quick", "Pro", "Premium"]);
    for (const r of rows) expect(r.desc.length).toBeGreaterThan(0);
  });
});
