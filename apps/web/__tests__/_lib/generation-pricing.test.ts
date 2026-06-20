/**
 * W95.7.3d-T1 — tier pricing: band thresholds, round-up gap rule (C3), weights.
 */

import { describe, it, expect } from "vitest";
import { computeTier, computeCreditWeight, tierWeight, TIER_WEIGHT } from "../../app/api/_lib/generation/pricing";

describe("computeTier (W95.7.3d-T1 bands + round-up gap)", () => {
  it("video $0.15 → quick (upper bound of quick)", () => { expect(computeTier(0.15, "video")).toBe("quick"); });
  it("video $2.40 → premium (lower bound of premium)", () => { expect(computeTier(2.40, "video")).toBe("premium"); });
  it("video $1.00 (gap $0.40–2.40) → premium (round-up, C3)", () => { expect(computeTier(1.00, "video")).toBe("premium"); });
  it("image $0.09 (gap $0.08–0.10) → premium (round-up, C3)", () => { expect(computeTier(0.09, "image")).toBe("premium"); });
  it("video $0.30 → pro; image $0.02 → quick (band interiors)", () => {
    expect(computeTier(0.30, "video")).toBe("pro");
    expect(computeTier(0.02, "image")).toBe("quick");
  });
});

describe("computeCreditWeight (locked weights)", () => {
  it("returns 4/8/60 for video tiers and 1/2/4 for image tiers", () => {
    expect(computeCreditWeight(0.10, "video")).toBe(4);  // quick
    expect(computeCreditWeight(0.30, "video")).toBe(8);  // pro
    expect(computeCreditWeight(2.50, "video")).toBe(60); // premium
    expect(computeCreditWeight(0.02, "image")).toBe(1);  // quick
    expect(computeCreditWeight(0.05, "image")).toBe(2);  // pro
    expect(computeCreditWeight(0.20, "image")).toBe(4);  // premium
    // tierWeight + the constant agree
    expect(tierWeight("video", "premium")).toBe(60);
    expect(TIER_WEIGHT.image.pro).toBe(2);
  });
});
