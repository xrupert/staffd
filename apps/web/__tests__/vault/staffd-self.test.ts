/**
 * W91.5 — STAFFD self-knowledge (fs-free). Parser + the embedded canonical
 * content loads with every Vault brand field populated. Parse failure → null
 * (fail-closed → loader falls through to the customer path).
 */

import { describe, it, expect } from "vitest";
import { parseStaffdSelf, staffdSelfVault } from "../../app/api/_lib/vault/staffd-self";

const VALID = `---
business_name: "STAFFD"
brand_voice: "You STAFF your business — it's a verb."
messaging_pillars:
  - "Staff your business"
  - "Departments are your org chart"
hard_nos:
  - "Never 'AI agent'"
average_ticket: "Starter $39/mo … Agency $450/mo."
seasonality_capacity: "SaaS — no seasonality."
review_count: 0
---
# body ignored
`;

describe("parseStaffdSelf", () => {
  it("maps frontmatter to the Vault shape (arrays joined, ticket/seasonality remapped, numbers coerced)", () => {
    const v = parseStaffdSelf(VALID)!;
    expect(v.business_name).toBe("STAFFD");
    expect(v.brand_voice).toMatch(/STAFF/);
    expect(v.messaging_pillars).toContain("Staff your business");
    expect(v.hard_nos).toMatch(/AI agent/);
    expect(v.avg_ticket).toContain("$39");
    expect(v.seasonality).toMatch(/SaaS/);
    expect(v.review_count).toBe(0);
    expect(typeof v.review_count).toBe("number");
  });

  it("returns null when there is no frontmatter (fail-closed)", () => {
    expect(parseStaffdSelf("no frontmatter here")).toBeNull();
    expect(parseStaffdSelf("")).toBeNull();
  });
});

describe("staffdSelfVault (embedded canonical content)", () => {
  it("loads with every Vault brand field populated", () => {
    const v = staffdSelfVault();
    expect(v).not.toBeNull();
    const required = ["brand_voice", "brand_tone", "brand_visuals", "messaging_pillars", "hard_nos", "customer_profile", "positioning", "service_area", "avg_ticket", "lead_sources", "seasonality"] as const;
    for (const k of required) {
      expect(String((v as Record<string, unknown>)[k] ?? "").length, `field ${k} populated`).toBeGreaterThan(0);
    }
    expect(v!.business_name).toBe("STAFFD");
  });
});
