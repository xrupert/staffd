/**
 * Sanity test — PR-Tranche-1-Pre-0.
 *
 * Verifies the test runner discovers + executes this file. Placeholder
 * until subsequent PRs (PR-Pre, PR-Bundle-3-A) add real tests against
 * agent registry + brand laws.
 */

import { describe, it, expect } from "vitest";

describe("test infrastructure sanity", () => {
  it("runs vitest successfully", () => {
    expect(true).toBe(true);
  });
});
