/**
 * W95.9.1 — the cinematic allowance gate. PURE math: given the plan, how many
 * cinematic clips the customer has already used this month, and any purchased
 * pack top-ups, decide whether a NEW cinematic project may start. The rule
 * (SA-ratified): gate only at project START — a project already in flight always
 * finishes; resets monthly; packs top up.
 */

import { describe, it, expect } from "vitest";
import { cinematicGate, daysUntilMonthlyReset } from "../../app/api/_lib/billing/cinematic-allowance";

describe("cinematicGate (W95.9.1)", () => {
  it("Pro with none used → allowed, full allowance remaining", () => {
    const g = cinematicGate("pro", 0);
    expect(g.allowed).toBe(true);
    expect(g.allowance).toBe(24);
    expect(g.remaining).toBe(24);
  });
  it("Pro at the cap → blocked, no remaining", () => {
    const g = cinematicGate("pro", 24);
    expect(g.allowed).toBe(false);
    expect(g.remaining).toBe(0);
  });
  it("Starter has no cinematic → always blocked (→ upsell)", () => {
    expect(cinematicGate("starter", 0).allowed).toBe(false);
  });
  it("pack top-ups extend the allowance", () => {
    const g = cinematicGate("pro", 20, 10);
    expect(g.allowance).toBe(34);
    expect(g.remaining).toBe(14);
    expect(g.allowed).toBe(true);
  });
  it("over-use (a project that ran past the cap) never goes negative", () => {
    expect(cinematicGate("growth", 12).remaining).toBe(0); // growth allowance 8
  });
});

describe("daysUntilMonthlyReset", () => {
  it("counts whole days to the 1st of next month (UTC)", () => {
    expect(daysUntilMonthlyReset(new Date("2026-06-24T00:00:00Z"))).toBe(7);
    expect(daysUntilMonthlyReset(new Date("2026-01-31T00:00:00Z"))).toBe(1);
  });
});
