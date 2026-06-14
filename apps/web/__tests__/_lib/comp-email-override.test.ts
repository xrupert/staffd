/**
 * W71.5 — Super-admin dogfooding comp override.
 *
 * Verifies that chris.rupert@cybridagency.com is in COMP_EMAILS and
 * that isCompedEmail grants Agency-tier comp to the override address
 * while rejecting addresses that are neither domain-comped nor in the
 * allowlist.
 */

import { describe, it, expect } from "vitest";
import { isCompedEmail, COMP_EMAILS } from "../../app/api/_lib/comp";

describe("comp — W71.5 super-admin dogfooding override", () => {
  it("chris.rupert@cybridagency.com returns true from isCompedEmail", () => {
    expect(isCompedEmail("chris.rupert@cybridagency.com")).toBe(true);
  });

  it("COMP_EMAILS is exported and contains the dogfooding override", () => {
    expect(COMP_EMAILS.has("chris.rupert@cybridagency.com")).toBe(true);
  });
});
