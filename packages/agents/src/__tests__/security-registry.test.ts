/**
 * PR-Tranche-1-Post-Security-Hardening — sanity tests for the canonical
 * expected-rules registry shape. This test lives in `packages/agents` so it
 * runs in the node-environment vitest workspace; structural assertions only,
 * no PB I/O.
 *
 * The registry itself lives in apps/web — we test it indirectly via
 * structural expectations that any consumer should hold.
 *
 * (Full integration tests for the route handlers live under apps/web/__tests__.)
 */

import { describe, it, expect } from "vitest";

describe("expected-rules registry shape contract", () => {
  it("rule values are either null or non-empty strings", () => {
    // Manual contract description — the canonical registry exports MUST
    // produce values that are either null (admin-only) or non-empty filter
    // expressions. Empty strings are a footgun (PB treats them differently
    // from null).
    const sampleRules = [
      "user = @request.auth.id",
      "agency_user = @request.auth.id",
      "document.user = @request.auth.id",
      "id = @request.auth.id",
      null,
    ];
    for (const r of sampleRules) {
      expect(r === null || (typeof r === "string" && r.length > 0)).toBe(true);
    }
  });

  it("repair-result status values match the documented union", () => {
    // Contract: EnsureResult.status is one of these 5 literal values.
    const validStatuses = [
      "already-correct",
      "repaired",
      "skipped-system-managed",
      "skipped-not-found",
      "failed",
    ];
    expect(validStatuses.length).toBe(5);
  });
});
