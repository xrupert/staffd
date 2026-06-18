/**
 * W95.7.1 — the clients UI is hidden (route 404s) but the `clients` collection
 * and its GDPR cascade are untouched (W94 will revive the surface).
 */

import { describe, it, expect, vi } from "vitest";

// next/navigation notFound() throws a NEXT_HTTP_ERROR_FALLBACK;404 — capture it.
const notFoundError = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({ notFound: () => { throw notFoundError; } }));

import ClientsPage from "../../app/dashboard/clients/page";
import { EXPECTED_COLLECTIONS } from "../../app/api/_lib/security/row-rules";

describe("clients UI hidden (W95.7.1)", () => {
  it("/dashboard/clients calls notFound() → route is not reachable", () => {
    expect(() => ClientsPage()).toThrow(notFoundError);
  });

  it("the `clients` collection itself is untouched (still in the row-rules registry)", () => {
    // Only the UI is hidden — the collection + its agency-owned rules persist
    // for W94's Operator Access System (and its GDPR cascade is unchanged).
    expect(EXPECTED_COLLECTIONS.some((e) => e.name === "clients")).toBe(true);
  });
});
