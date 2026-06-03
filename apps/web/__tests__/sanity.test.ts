/**
 * Sanity test — PR-Tranche-1-Pre-0.
 *
 * Verifies the apps/web Vitest runner with happy-dom discovers + executes
 * this file. Placeholder until subsequent PRs add real tests against
 * route handlers and React components.
 */

import { describe, it, expect } from "vitest";

describe("test infrastructure sanity", () => {
  it("runs vitest in apps/web", () => {
    expect(true).toBe(true);
  });
});
