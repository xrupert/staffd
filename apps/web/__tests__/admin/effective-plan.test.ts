/**
 * W92.1 — effectivePlan: comp + operator accounts operate at Agency even
 * though their stored subscriptions.plan is still "starter". Non-comp users
 * keep their actual stored plan (regression).
 */

import { describe, it, expect } from "vitest";
import { effectivePlan } from "../../app/api/_lib/comp";

const ADMIN = "chris.rupert@cybridagency.com";

describe("effectivePlan", () => {
  it("comp-domain users render as agency regardless of stored plan", () => {
    expect(effectivePlan("kalebc@jrw-solutions.com", "starter")).toBe("agency");
    expect(effectivePlan("jaxr@jrw-solutions.com", "starter")).toBe("agency");
  });

  it("the operator (in COMP_EMAILS) renders as agency", () => {
    expect(effectivePlan(ADMIN, "starter")).toBe("agency");
  });

  it("an explicit adminEmail match renders as agency (robustness)", () => {
    expect(effectivePlan("founder@staffd.com", "starter", "founder@staffd.com")).toBe("agency");
  });

  it("REGRESSION — a real paying customer keeps their actual stored plan", () => {
    expect(effectivePlan("jane@acme.com", "growth", ADMIN)).toBe("growth");
    expect(effectivePlan("bob@widgets.io", "pro")).toBe("pro");
    expect(effectivePlan("sam@startup.co", "starter")).toBe("starter");
  });

  it("a customer with no stored plan is 'none'", () => {
    expect(effectivePlan("nobody@acme.com", undefined)).toBe("none");
    expect(effectivePlan("nobody@acme.com", "")).toBe("none");
  });

  it("is case-insensitive on the comp email match", () => {
    expect(effectivePlan("Kalebc@JRW-Solutions.com", "starter")).toBe("agency");
  });
});
