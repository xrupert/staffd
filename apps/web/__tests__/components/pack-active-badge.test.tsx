/**
 * W58.3 Test 7 — PackActiveBadge copy review.
 *
 * The badge stays (SA Decision 3). Its copy must imply inclusion, never
 * purchase.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import PackActiveBadge from "../../app/components/PackActiveBadge";

void React;

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1" }, isValid: true, token: "tok" },
    collection: () => ({ getList: async () => ({ items: [] }) }),
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PackActiveBadge (W58.3 copy review)", () => {
  it("renders inclusion copy for an active pack; no purchase implication", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        packs: [{
          id: "restaurants", name: "Restaurants Pack", icon: "🍽️",
          departments: ["finance", "operations"], agentCount: 7, active: true,
        }],
        activePackIds: ["restaurants"],
      }),
    })));

    const { container, findByText } = render(<PackActiveBadge department="finance" />);

    expect(await findByText("Pack active")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("Restaurants Pack");
    expect(text).toContain("Your specialists below include pack-only experts.");
    expect(text).not.toMatch(/you bought|your purchase|paid|\$\d|buy/i);
  });
});
