/**
 * W50 Tests 1–3, 6–8 — Business Profile editor + schema + lock pins.
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

void React;

const pbMocks = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  creates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1" }, isValid: true, token: "tok" },
    collection: () => ({
      getList: async () => ({ items: pbMocks.existing ? [pbMocks.existing] : [] }),
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

import VaultEditor from "../../app/components/VaultEditor";

const W50_FIELDS = [
  "brand_voice", "brand_tone", "brand_visuals", "messaging_pillars", "hard_nos",
  "customer_profile", "positioning", "service_area",
  "avg_ticket", "lead_sources", "seasonality",
  "review_count", "review_rating", "review_platform",
];

beforeEach(() => {
  pbMocks.existing = { id: "biz_1" };
  pbMocks.updates = [];
  pbMocks.creates = [];
});

afterEach(cleanup);

describe("schema (W50 Test 1)", () => {
  it("setup/businesses declares all 14 W50 fields, numbers typed as number", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "api", "setup", "businesses", "route.ts"),
      "utf8"
    );
    for (const f of W50_FIELDS) {
      expect(src, `missing field ${f}`).toContain(`"${f}"`);
    }
    expect(src).toMatch(/"review_count",\s+type: "number"/);
    expect(src).toMatch(/"review_rating",\s+type: "number"/);
  });
});

describe("VaultEditor (W50 Tests 2, 3, 6, 7)", () => {
  it("renders all 4 categories with their fields (Test 2)", async () => {
    const { findByText, getByLabelText } = render(<VaultEditor />);
    expect(await findByText("Brand & Voice")).toBeTruthy();
    expect(await findByText("Customer & Market")).toBeTruthy();
    expect(await findByText("Operations")).toBeTruthy();
    expect(await findByText("Reputation")).toBeTruthy();
    expect(getByLabelText("Brand voice")).toBeTruthy();
    expect(getByLabelText("Hard nos")).toBeTruthy();
    expect(getByLabelText("Service area")).toBeTruthy();
    expect(getByLabelText("Seasonality & capacity")).toBeTruthy();
    expect(getByLabelText("Review rating (0–5)")).toBeTruthy();
  });

  it("save writes exactly the touched fields (Test 3)", async () => {
    const { findByText, getByLabelText, getByText } = render(<VaultEditor />);
    await findByText("Brand & Voice");

    fireEvent.change(getByLabelText("Brand voice"), { target: { value: "Direct, no jargon" } });
    fireEvent.change(getByLabelText("Service area"), { target: { value: "Brooklyn + Queens" } });
    fireEvent.change(getByLabelText("Average ticket"), { target: { value: "$2,500" } });
    fireEvent.change(getByLabelText("Review count"), { target: { value: "132" } });
    fireEvent.change(getByLabelText("Review rating (0–5)"), { target: { value: "4.7" } });
    fireEvent.click(getByText("Save"));

    await waitFor(() => expect(pbMocks.updates).toHaveLength(1));
    expect(pbMocks.updates[0]!.payload).toEqual({
      brand_voice: "Direct, no jargon",
      service_area: "Brooklyn + Queens",
      avg_ticket: "$2,500",
      review_count: 132,
      review_rating: 4.7,
    });
  });

  it("handles a user with no business record — save creates one (Test 6)", async () => {
    pbMocks.existing = null;
    const { findByText, getByLabelText, getByText } = render(<VaultEditor />);
    await findByText("Brand & Voice");

    fireEvent.change(getByLabelText("Positioning"), { target: { value: "Only same-day service in the borough" } });
    fireEvent.click(getByText("Save"));

    await waitFor(() => expect(pbMocks.creates).toHaveLength(1));
    expect(pbMocks.creates[0]).toMatchObject({
      user: "user-1",
      positioning: "Only same-day service in the borough",
    });
  });

  it("review_rating accepts 4.7, rejects non-numbers, clamps to 0–5 (Test 7)", async () => {
    const { findByText, getByLabelText, getByText, container } = render(<VaultEditor />);
    await findByText("Brand & Voice");
    const rating = getByLabelText("Review rating (0–5)");

    // Non-number rejected with visible error, no write.
    fireEvent.change(rating, { target: { value: "abc" } });
    fireEvent.click(getByText("Save"));
    await waitFor(() => expect(container.textContent).toContain("needs a number"));
    expect(pbMocks.updates).toHaveLength(0);

    // Out-of-range clamps to 5.
    fireEvent.change(rating, { target: { value: "7.2" } });
    fireEvent.click(getByText("Save"));
    await waitFor(() => expect(pbMocks.updates).toHaveLength(1));
    expect(pbMocks.updates[0]!.payload.review_rating).toBe(5);
  });
});

describe("T3.0 lock pin (W50 Test 8)", () => {
  it("the settings page touch introduces no credit-display surfaces", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "dashboard", "settings", "page.tsx"),
      "utf8"
    );
    expect(src).toContain("<VaultEditor />");
    expect(src).not.toMatch(/agent.{0,5}credit|credits remaining|CreditsWidget|LowCreditsBanner/i);
  });
});
