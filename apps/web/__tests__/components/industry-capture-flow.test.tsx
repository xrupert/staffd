/**
 * W59 Tests 1, 3, 4 — schema pin, onboarding capture, settings edit.
 *
 * Test 1 is a static schema pin (the ensureCollection idempotency engine
 * is shared and already trusted). Test 3 exercises onboarding step 1's
 * required-picker gate. Test 4 exercises the settings inline edit's PB
 * write payload.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

void React;

const pbMocks = vi.hoisted(() => ({
  updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  creates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1", email: "u@test" }, isValid: true, token: "tok" },
    collection: () => ({
      getList: async () => ({ items: [{ id: "biz_1" }] }),
      update: async (id: string, payload: Record<string, unknown>) => {
        pbMocks.updates.push({ id, payload });
        return { id };
      },
      create: async (payload: Record<string, unknown>) => {
        pbMocks.creates.push(payload);
        return { id: "biz_new" };
      },
    }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import OnboardingPage from "../../app/onboarding/page";
import IndustryPacksPanel from "../../app/components/IndustryPacksPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  pbMocks.updates = [];
  pbMocks.creates = [];
});

describe("schema (W59 Test 1)", () => {
  it("setup/businesses declares industry_category as optional text", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "api", "setup", "businesses", "route.ts"),
      "utf8"
    );
    expect(src).toMatch(/\{ name: "industry_category", type: "text", required: false \}/);
  });
});

describe("onboarding capture (W59 Test 3)", () => {
  it("step 1 requires the picker; selecting a category enables Continue and saves both fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const { getByText, container } = render(<OnboardingPage />);

    // Picker present in step 1 with the locked question + detail label.
    expect(getByText("What kind of business do you run?")).toBeTruthy();
    const detailLabel = getByText("Anything else about your business? (optional)");
    // OnboardingField renders label + input as siblings (no htmlFor).
    const detail = detailLabel.parentElement?.querySelector("input");
    expect(detail).toBeTruthy();

    // Continue gated until a chip is picked.
    const continueBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => /continue|next/i.test(b.textContent ?? ""));
    expect(continueBtn).toBeTruthy();
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(getByText("Restaurants & Food Service"));
    fireEvent.change(detail!, { target: { value: "Italian bistro in Brooklyn" } });

    await waitFor(() => {
      expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("handleFinish payload includes industry_category + detail (source pin)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app", "onboarding", "page.tsx"), "utf8");
    expect(src).toContain('industry_category: industryCategory || "other"');
    expect(src).toContain('industry: industryDetail || (prefillData?.industry ?? "")');
  });
});

describe("settings edit (W59 Test 4)", () => {
  it("Change industry → pick → Save writes industry_category to the businesses record", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, packs: [], activePackIds: [] }),
    })));

    const { findByText, getByText } = render(<IndustryPacksPanel />);

    // Edit affordance visible on first paint (SA acceptance addition).
    fireEvent.click(await findByText("Change industry →"));
    fireEvent.click(getByText("Real Estate"));
    fireEvent.click(getByText("Save"));

    await waitFor(() => {
      expect(pbMocks.updates).toHaveLength(1);
    });
    expect(pbMocks.updates[0]!.id).toBe("biz_1");
    expect(pbMocks.updates[0]!.payload).toEqual({ industry_category: "real-estate" });
  });
});
