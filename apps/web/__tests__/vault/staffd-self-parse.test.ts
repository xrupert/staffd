/**
 * W91.5 — STAFFD self-knowledge canonical Vault source.
 * Parser (frontmatter → Vault) + the real STAFFD_SELF.md loads with every
 * Vault field populated. Parse failure must return null (fail-closed →
 * loader falls through to the customer path).
 */

import { describe, it, expect } from "vitest";
import { parseStaffdSelf, staffdSelfVault } from "../../app/api/_lib/vault/staffd-self";

const VALID = `---
business_name: "STAFFD"
brand_voice: "You STAFF your business — it's a verb."
brand_tone: "Direct, confident, specific, owner-respectful."
brand_visuals: "LSU Purple #5B21E8 on near-black."
messaging_pillars:
  - "Staff your business"
  - "Departments are your org chart"
hard_nos:
  - "Never 'AI agent'"
  - "Never 'subscribe'"
customer_profile: "SMBs and solo founders."
positioning: "The Porsche of business tooling."
service_area: "Global, online."
average_ticket: "Starter $39/mo … Agency $450/mo."
lead_sources: "Demo-based selling."
seasonality_capacity: "SaaS — no seasonality."
review_count: 0
review_rating: 0
review_platform: ""
---

# Notes
Markdown body is ignored by the parser.
`;

describe("parseStaffdSelf", () => {
  it("maps frontmatter to the Vault shape (arrays joined, ticket/seasonality remapped, numbers coerced)", () => {
    const v = parseStaffdSelf(VALID)!;
    expect(v).not.toBeNull();
    expect(v.business_name).toBe("STAFFD");
    expect(v.brand_voice).toMatch(/STAFF/);
    expect(v.messaging_pillars).toContain("Staff your business");
    expect(v.messaging_pillars).toContain("Departments are your org chart");
    expect(v.hard_nos).toMatch(/AI agent/);
    expect(v.avg_ticket).toContain("$39");       // average_ticket → avg_ticket
    expect(v.seasonality).toMatch(/SaaS/);       // seasonality_capacity → seasonality
    expect(v.review_count).toBe(0);
    expect(typeof v.review_count).toBe("number");
  });

  it("returns null when there is no frontmatter (fail-closed)", () => {
    expect(parseStaffdSelf("just some markdown, no frontmatter")).toBeNull();
    expect(parseStaffdSelf("")).toBeNull();
  });

  it("the real STAFFD_SELF.md loads with every Vault brand field populated", () => {
    const v = staffdSelfVault();
    expect(v).not.toBeNull();
    const required = ["brand_voice", "brand_tone", "brand_visuals", "messaging_pillars", "hard_nos", "customer_profile", "positioning", "service_area", "avg_ticket", "lead_sources", "seasonality"] as const;
    for (const k of required) {
      expect(String((v as Record<string, unknown>)[k] ?? "").length, `field ${k} should be populated`).toBeGreaterThan(0);
    }
    expect(v!.business_name).toBe("STAFFD");
  });
});
