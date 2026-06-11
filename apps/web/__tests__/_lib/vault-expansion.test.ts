/**
 * W50 Tests 4–5 — vault loader surfaces the new fields; the prompt
 * renderer includes them in the specialist context block.
 */

import { describe, it, expect } from "vitest";
import { vaultLines, renderVaultBlock, type Vault } from "../../app/api/_lib/vault/index";

const FULL_VAULT: Vault = {
  business_name: "Luigi's",
  industry: "Italian restaurant",
  brand_voice: "Warm, family-table, never corporate",
  brand_tone: "Friendly but professional",
  brand_visuals: "Deep green + cream, serif headers",
  messaging_pillars: "Fresh pasta daily; family recipes; neighborhood institution",
  hard_nos: "Never discount the tasting menu; never mention competitors",
  customer_profile: "Families and date-night couples within 3 miles",
  positioning: "The only fresh-pasta kitchen in the neighborhood",
  service_area: "Carroll Gardens, Cobble Hill, Park Slope",
  avg_ticket: "$85 per table",
  lead_sources: "Walk-ins, Google Maps, Infatuation list",
  seasonality: "Slow January–February; patio doubles capacity May–September",
  review_count: 312,
  review_rating: 4.7,
  review_platform: "Google",
};

describe("vault expansion (W50 Tests 4–5)", () => {
  it("all 14 W50 fields surface on the vault object and in vaultLines (Test 4)", () => {
    const lines = vaultLines(FULL_VAULT).join("\n");
    expect(lines).toContain("Brand voice: Warm, family-table");
    expect(lines).toContain("Brand tone: Friendly but professional");
    expect(lines).toContain("Brand visuals: Deep green");
    expect(lines).toContain("Messaging pillars: Fresh pasta daily");
    expect(lines).toContain("Hard nos (never say, do, or claim): Never discount");
    expect(lines).toContain("Customer profile: Families");
    expect(lines).toContain("Positioning vs competitors: The only fresh-pasta");
    expect(lines).toContain("Service area: Carroll Gardens");
    expect(lines).toContain("Average ticket / job size: $85");
    expect(lines).toContain("Lead sources: Walk-ins");
    expect(lines).toContain("Seasonality / capacity: Slow January");
    expect(lines).toContain("Reviews: 312 averaging 4.7/5 on Google");
  });

  it("renderVaultBlock (specialist prompt context) carries the new fields (Test 5)", () => {
    const block = renderVaultBlock(FULL_VAULT, { detail: "full" });
    expect(block).toContain("--- BUSINESS VAULT ---");
    expect(block).toContain("Hard nos (never say, do, or claim)");
    expect(block).toContain("Service area: Carroll Gardens");
    expect(block).toContain("Reviews: 312 averaging 4.7/5 on Google");
  });

  it("unset fields stay silent — no empty-labelled lines", () => {
    const lines = vaultLines({ business_name: "Bare Co" }).join("\n");
    expect(lines).toBe("Business name: Bare Co");
  });
});
