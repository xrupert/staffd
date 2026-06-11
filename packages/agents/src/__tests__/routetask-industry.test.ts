/**
 * W58 — Pack-aware routing + industry scoring (D-19 routing layer).
 *
 * Pins: entitlement-gated pool inclusion (owned packs only — SA ruling
 * on W58 Phase A conflict #1), the 1.5× industry boost, backward compat
 * with the W54 baseline, and the free-text industry → pack id resolver.
 *
 * Expected ids verified empirically against the live registry.
 */

import { describe, it, expect } from "vitest";
import {
  routeTask,
  getDepartmentAgents,
  resolveIndustryToPackId,
} from "../index";

describe("routeTask — industry boost (W58 Tests 1–2)", () => {
  it("pack agent wins in matching industry with owned pack (Test 1)", () => {
    const match = routeTask("track COGS and inventory variance this month", "finance", {
      activePacks: ["restaurants"],
      userIndustry: "restaurants",
    });
    expect(match?.id).toBe("pack-restaurants-finance-cogs-tracker");
  });

  it("non-matching industry — restaurants pack agent excluded from a law user's pool (Test 2)", () => {
    const match = routeTask("track COGS and inventory variance this month", "finance", {
      activePacks: ["law"],
      userIndustry: "law",
    });
    // Generic finance agent wins ("variance" overlap); the restaurants
    // pack agent is not in this user's pool — pool membership is
    // activePacks-driven (derived upstream in trial.ts; W58.0.1 bridges
    // industry → activePacks there, so a restaurant user's pool would
    // include it, a law user's never does).
    expect(match?.id).toBe("finance-fpa-analyst");
    expect(match?.id).not.toBe("pack-restaurants-finance-cogs-tracker");
  });
});

describe("routeTask — backward compat (W58 Test 3)", () => {
  it("no-opts calls behave identically to the W54 baseline", () => {
    // Same assertions as routetask-case.test.ts (W54 suite):
    expect(routeTask("draft an NDA", "legal")?.id).toBe("legal-document-drafter");
    expect(routeTask("track COGS and inventory variance this month")?.id).toBe(
      "pack-restaurants-finance-cogs-tracker"
    );
    expect(routeTask("tell me a joke")).toBeUndefined();
  });
});

describe("routeTask — multiplier effect (W58 Test 4)", () => {
  it("1.5× tips a 1-tag tie to the industry pack agent; without industry, generic first-found wins", () => {
    // "help with a vendor invoice": generic finance-invoice-generator hits
    // "invoice" (base 1, earlier in pool); pack cogs-tracker hits
    // "vendor invoice" (base 1). Verified empirically.
    const task = "help with a vendor invoice";
    const boosted = routeTask(task, "finance", {
      activePacks: ["restaurants"],
      userIndustry: "restaurants",
    });
    expect(boosted?.id).toBe("pack-restaurants-finance-cogs-tracker");

    const unboosted = routeTask(task, "finance", { activePacks: ["restaurants"] });
    expect(unboosted?.id).toBe("finance-invoice-generator");
  });
});

describe("getDepartmentAgents — pool inclusion is activePacks-driven (W58 Test 5)", () => {
  // activePacks derivation (purchase, comp, or W58.0.1 industry bridging)
  // happens upstream in trial.ts — this function honors whatever it's given.
  it("active packs add their department agents; inactive never appear", () => {
    const generic = getDepartmentAgents("operations").length;
    expect(generic).toBe(12);
    expect(getDepartmentAgents("operations", { activePacks: ["restaurants"] }).length).toBe(generic + 1);
    expect(getDepartmentAgents("operations", { activePacks: ["law"] }).length).toBe(generic + 1);
    // No activePacks → generic only, regardless of anything else.
    expect(
      getDepartmentAgents("operations").every((a) => !a.pack)
    ).toBe(true);
  });
});

describe("resolveIndustryToPackId (W58 Tests 6–8)", () => {
  it("resolves all 8 canonical pack ids directly (Test 6)", () => {
    for (const id of ["law", "real-estate", "restaurants", "coaches", "trades", "salons", "agencies", "consultants"] as const) {
      expect(resolveIndustryToPackId(id)).toBe(id);
    }
  });

  it("resolves representative free-text descriptions (Test 6b)", () => {
    expect(resolveIndustryToPackId("We run a small italian restaurant")).toBe("restaurants");
    expect(resolveIndustryToPackId("Solo attorney, family law office")).toBe("law");
    expect(resolveIndustryToPackId("HVAC and plumbing services")).toBe("trades");
    expect(resolveIndustryToPackId("hair salon and day spa")).toBe("salons");
    expect(resolveIndustryToPackId("residential real estate brokerage")).toBe("real-estate");
    expect(resolveIndustryToPackId("executive coaching for founders")).toBe("coaches");
    expect(resolveIndustryToPackId("boutique marketing agency")).toBe("agencies");
    expect(resolveIndustryToPackId("independent management consultant")).toBe("consultants");
    // Vertical-before-generic order (SA-acked §J): restaurant consultant
    // lands on the richer restaurants pack.
    expect(resolveIndustryToPackId("restaurant consulting")).toBe("restaurants");
  });

  it("unknown / empty / undefined return null (Test 7)", () => {
    expect(resolveIndustryToPackId("manufacturing")).toBeNull();
    expect(resolveIndustryToPackId("saas startup")).toBeNull();
    expect(resolveIndustryToPackId("")).toBeNull();
    expect(resolveIndustryToPackId(undefined)).toBeNull();
    expect(resolveIndustryToPackId(null)).toBeNull();
    // Bare "agency" deliberately does NOT match (travel/insurance/staffing
    // agencies are not the marketing-agencies pack).
    expect(resolveIndustryToPackId("travel agency")).toBeNull();
  });

  it("normalization — case and whitespace insensitive (Test 8)", () => {
    expect(resolveIndustryToPackId("Restaurants")).toBe("restaurants");
    expect(resolveIndustryToPackId("restaurants")).toBe("restaurants");
    expect(resolveIndustryToPackId("  restaurants  ")).toBe("restaurants");
    expect(resolveIndustryToPackId("LAW FIRM")).toBe("law");
  });
});
