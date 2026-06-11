/**
 * W58.3 Tests 2–4 — IndustryPacksPanel reframe ("Your industry support").
 *
 * The panel is informational only: no buy buttons, no prices, no portal
 * link. Copy per the locked Decision 2 forms — single-pack, no-match,
 * and comp (all 8 verticals) branches.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import IndustryPacksPanel from "../../app/components/IndustryPacksPanel";

void React;

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1" }, isValid: true, token: "tok" },
    collection: () => ({ getList: async () => ({ items: [] }) }),
  },
}));

const PACK_NAMES: Record<string, string> = {
  law: "Law Firm Pack", "real-estate": "Real Estate Pack", restaurants: "Restaurants Pack",
  coaches: "Coaches Pack", trades: "Trades Pack", salons: "Salons & Spas Pack",
  agencies: "Agencies Pack", consultants: "Consultants Pack",
};

function makePacks(activeIds: string[]) {
  return Object.entries(PACK_NAMES).map(([id, name]) => ({
    id, name,
    description: `${name} description`,
    icon: "📦",
    agentCount: 7,
    departments: ["marketing", "finance"],
    active: activeIds.includes(id),
  }));
}

function mockPacksApi(activeIds: string[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, packs: makePacks(activeIds), activePackIds: activeIds }),
  })));
}

const FORBIDDEN = /buy|purchase|\$\d|upsell|opening stripe|manage subscriptions/i;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("IndustryPacksPanel (W58.3 reframe)", () => {
  it("paying user with matching industry — informational pack line, no purchase semantics (Test 2)", async () => {
    mockPacksApi(["restaurants"]);
    const { container, findByText } = render(<IndustryPacksPanel />);

    expect(await findByText("Your industry support")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("Your business industry unlocks Restaurants Pack");
    expect(text).toContain("7 specialists");
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("paying user with no industry match — locked no-match copy (Test 3)", async () => {
    mockPacksApi([]);
    const { container, findByText } = render(<IndustryPacksPanel />);

    expect(await findByText("Your industry support")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("No industry pack matches your profile yet.");
    expect(text).toContain("Update your industry to unlock industry-specific staff.");
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("comp user — all 8 verticals line, no purchase CTA (Test 4)", async () => {
    mockPacksApi(Object.keys(PACK_NAMES));
    const { container, findByText } = render(<IndustryPacksPanel />);

    expect(await findByText("Your industry support")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("Industry support active across all 8 verticals");
    expect(text).not.toMatch(FORBIDDEN);
  });
});
