/**
 * T3.0 — CreditsWidget §12 truth-lock contract tests (W14, W15).
 *
 * ARCH §12: credits exist for IMAGES and VIDEOS only. Specialist
 * conversations are unlimited — no agent/specialist/conversation/message
 * credit counter may ever render. The API may still emit
 * `agentCreditsTopup` as a soft counter; it must stay invisible.
 *
 * §12 hard rule: "Comp users never see 'out of credits.'" — comp accounts
 * (100× Agency allowance) render "Unlimited" with no Top-up CTA and no
 * low-balance styling.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import CreditsWidget from "../../app/components/CreditsWidget";

void React;

// Mock PocketBase auth — widget needs an authed user id to fetch credits.
vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-test-1" }, isValid: true, token: "tok" },
    collection: () => ({ getList: async () => ({ items: [] }) }),
  },
}));

// Forbidden strings per the T3.0 contract — no agent/specialist/
// conversation/message credit language anywhere in the rendered tree.
const FORBIDDEN =
  /agent.{0,5}credit|specialist.{0,5}credit|conversation.{0,5}credit|message.{0,5}credit|\bruns? (left|remaining)\b/i;

function mockCredits(state: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => state,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("document", document); // happy-dom provides document
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreditsWidget (T3.0 §12 truth lock)", () => {
  it("Growth plan — renders image/video counters only, ignores agentCreditsTopup", async () => {
    mockCredits({
      plan: "growth",
      monthlyAllowance: { image: 300, video: 10 },
      monthlyUsed: { image: 50, video: 2 },
      topupBalance: { image: 0, video: 0 },
      monthlyRemaining: { image: 250, video: 8 },
      totalRemaining: { image: 250, video: 8 },
      agentCreditsTopup: 999, // backend soft counter — must stay invisible
      ceoAddonActive: false,
    });

    const { container, findByText, getAllByTestId } = render(<CreditsWidget />);

    expect(await findByText("250 left this month")).toBeTruthy();
    expect(await findByText("8 left this month")).toBeTruthy();
    expect(await findByText("images")).toBeTruthy();
    expect(await findByText("videos")).toBeTruthy();

    // Exactly two tiles — no Agent tile.
    expect(getAllByTestId("credit-tile")).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    // The ignored agent value must not leak anywhere.
    expect(text).not.toContain("999");

    // Healthy balances (83%, 80%) — Top-up CTA below thresholds only.
    expect(text).not.toContain("Top up");
  });

  it("Comp account — renders Unlimited tiles, no Top-up CTA, no low styling", async () => {
    mockCredits({
      plan: "agency",
      monthlyAllowance: { image: 180000, video: 6000 },
      monthlyUsed: { image: 0, video: 0 },
      topupBalance: { image: 0, video: 0 },
      monthlyRemaining: { image: 180000, video: 6000 },
      totalRemaining: { image: 180000, video: 6000 },
      agentCreditsTopup: 0,
      ceoAddonActive: true,
    });

    const { container, findAllByText } = render(<CreditsWidget />);

    const unlimited = await findAllByText("Unlimited");
    expect(unlimited).toHaveLength(2);

    const text = container.textContent ?? "";
    expect(text).not.toContain("Top up");
    expect(text).not.toContain("running low");
    expect(text).not.toMatch(/out of credits/i);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("Empty state — missing credit fields do not crash or render an empty shell", async () => {
    mockCredits({});

    const { container, findByText } = render(<CreditsWidget />);

    // Tiles render with labels even when the API response is bare.
    expect(await findByText("images")).toBeTruthy();
    expect(await findByText("videos")).toBeTruthy();

    await waitFor(() => {
      const text = container.textContent ?? "";
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toMatch(FORBIDDEN);
    });
  });
});
