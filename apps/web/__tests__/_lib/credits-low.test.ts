/**
 * W95.8.1 — crossedLowCredits: fire the `credits.low` notification ONCE, on the
 * spend that drops a customer's per-kind balance from above the low-water mark
 * to at/below it. Never re-fires while they stay low (no nagging every spend).
 */

import { describe, it, expect } from "vitest";
import { crossedLowCredits, LOW_CREDITS } from "../../app/api/_lib/credits";

describe("crossedLowCredits", () => {
  it("fires when a spend crosses the low-water mark downward", () => {
    expect(crossedLowCredits(LOW_CREDITS + 1, LOW_CREDITS)).toBe(true);
    expect(crossedLowCredits(20, 3)).toBe(true);
    expect(crossedLowCredits(7, 0)).toBe(true); // spent down to zero
  });

  it("does NOT fire when already at/below the mark (no repeat nagging)", () => {
    expect(crossedLowCredits(LOW_CREDITS, LOW_CREDITS - 1)).toBe(false);
    expect(crossedLowCredits(3, 1)).toBe(false);
    expect(crossedLowCredits(0, 0)).toBe(false);
  });

  it("does NOT fire when the balance stays comfortably above the mark", () => {
    expect(crossedLowCredits(100, 40)).toBe(false);
    expect(crossedLowCredits(LOW_CREDITS + 10, LOW_CREDITS + 1)).toBe(false);
  });
});
