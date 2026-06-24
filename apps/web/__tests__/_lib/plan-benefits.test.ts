/**
 * W95.9 — plan benefits are the single typed source of truth for the
 * value-priced, meter-buried model: each plan includes unlimited everyday
 * generation + a monthly CINEMATIC allowance (the only real cost center). The
 * UI, the project-start allowance gate, and the upsell all read from here.
 */

import { describe, it, expect } from "vitest";
import {
  cinematicAllowance,
  planIncludesCinematic,
  commercialsFromClips,
  CINEMA_PACKS,
  PLAN_BENEFITS,
} from "../../app/api/_lib/billing/plan-benefits";

describe("plan cinematic allowances (W95.9)", () => {
  it("match the ratified table (clips/mo; Agency tops at 60)", () => {
    expect(cinematicAllowance("starter")).toBe(0);
    expect(cinematicAllowance("growth")).toBe(8);
    expect(cinematicAllowance("pro")).toBe(24);
    expect(cinematicAllowance("agency")).toBe(60);
  });
  it("unknown / unset plan is treated as no cinematic (safe default → upsell)", () => {
    expect(cinematicAllowance("nope")).toBe(0);
    expect(cinematicAllowance(undefined)).toBe(0);
  });
  it("planIncludesCinematic reflects the allowance", () => {
    expect(planIncludesCinematic("starter")).toBe(false);
    expect(planIncludesCinematic("growth")).toBe(true);
    expect(planIncludesCinematic("pro")).toBe(true);
  });
  it("everyday video is a bounded fair-use ceiling, not unlimited", () => {
    expect(PLAN_BENEFITS.starter.everydayVideoPerMonth).toBe(25);
    expect(PLAN_BENEFITS.agency.everydayVideoPerMonth).toBe(250);
    for (const b of Object.values(PLAN_BENEFITS)) expect(b.everydayVideoPerMonth).toBeGreaterThan(0);
  });
  it("translates a clip allowance into finished commercials (~8 clips each)", () => {
    expect(commercialsFromClips(24)).toBe(3);
    expect(commercialsFromClips(60)).toBe(7);
    expect(commercialsFromClips(8)).toBe(1);
  });
});

describe("cinema extension packs", () => {
  it("offers a +10/$39 and +30/$99 top-up with cinematic counts", () => {
    const ten = CINEMA_PACKS.find((p) => p.cinematic === 10);
    const thirty = CINEMA_PACKS.find((p) => p.cinematic === 30);
    expect(ten?.priceCents).toBe(3900);
    expect(thirty?.priceCents).toBe(9900);
  });
  it("every pack price covers its model cost (margin-positive at $2.50/clip)", () => {
    for (const p of CINEMA_PACKS) {
      expect(p.priceCents).toBeGreaterThan(p.cinematic * 250);
    }
  });
});
