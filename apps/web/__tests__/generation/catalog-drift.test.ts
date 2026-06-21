/**
 * W95.7.3d-h3 — catalog drift detection. The hourly Muapi catalog sync used to
 * see ONLY routing-slug drift; it was blind to price/tier changes (a margin
 * risk, Standard #33) and to models appearing/disappearing. computeCatalogDrift
 * is the pure diff of the previous cache vs the freshly-classified catalog, so
 * the cron can emit a structured signal when something material moves.
 */

import { describe, it, expect } from "vitest";
import { computeCatalogDrift, type CachedModel } from "../../app/api/_lib/generation/catalog";

const m = (name: string, cost_usd: number | null, tier: string, credit_weight: number): CachedModel => ({ name, cost_usd, tier, credit_weight });

describe("computeCatalogDrift", () => {
  it("no changes → all-empty drift", () => {
    const prev = [m("flux-1-dev", 0.05, "pro", 2), m("veo-3", 0.30, "pro", 8)];
    const next = [m("flux-1-dev", 0.05, "pro", 2), m("veo-3", 0.30, "pro", 8)];
    const d = computeCatalogDrift(prev, next);
    expect(d).toEqual({ priceChanges: [], newModels: [], removedModels: [] });
  });

  it("detects a price/tier/weight change on a model present in both", () => {
    const prev = [m("flux-1-dev", 0.05, "pro", 2)];
    const next = [m("flux-1-dev", 0.12, "premium", 4)]; // repriced up a tier
    const d = computeCatalogDrift(prev, next);
    expect(d.priceChanges).toEqual([
      { name: "flux-1-dev", from: { cost_usd: 0.05, tier: "pro", credit_weight: 2 }, to: { cost_usd: 0.12, tier: "premium", credit_weight: 4 } },
    ]);
    expect(d.newModels).toEqual([]);
    expect(d.removedModels).toEqual([]);
  });

  it("detects new and removed models", () => {
    const prev = [m("old-model", 0.05, "pro", 2), m("stays", 0.02, "quick", 1)];
    const next = [m("stays", 0.02, "quick", 1), m("brand-new", 0.20, "premium", 4)];
    const d = computeCatalogDrift(prev, next);
    expect(d.newModels).toEqual(["brand-new"]);
    expect(d.removedModels).toEqual(["old-model"]);
    expect(d.priceChanges).toEqual([]);
  });

  it("a dynamic-priced model flipping cost_usd null↔number counts as a change", () => {
    const prev = [m("dyn", null, "", 0)];
    const next = [m("dyn", 0.07, "pro", 2)];
    const d = computeCatalogDrift(prev, next);
    expect(d.priceChanges).toHaveLength(1);
    expect(d.priceChanges[0]!.from.cost_usd).toBeNull();
    expect(d.priceChanges[0]!.to.cost_usd).toBe(0.07);
  });

  it("empty previous cache (first sync) → every model is new, no false price changes", () => {
    const next = [m("a", 0.05, "pro", 2), m("b", 0.20, "premium", 4)];
    const d = computeCatalogDrift([], next);
    expect(d.newModels).toEqual(["a", "b"]);
    expect(d.priceChanges).toEqual([]);
    expect(d.removedModels).toEqual([]);
  });
});
