/**
 * W95.7.3d-T1 — GenerationTierModal: three tiers, department default selected +
 * "✓ recommended", balance footer, and tier override updates the confirm button.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/pb", () => ({ default: { authStore: { record: { id: "u1" }, token: "tok" } } }));
import GenerationTierModal from "../../app/components/GenerationTierModal";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ totalRemaining: { video: 120, image: 9 } }) }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("GenerationTierModal (W95.7.3d-T1)", () => {
  it("renders three tiers, marketing-video default (Pro) recommended, balance footer", async () => {
    render(<GenerationTierModal pending={{ kind: "video", department: "marketing", prompt: "x" }} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Quick")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText("Premium")).toBeTruthy();
    expect(screen.getByText(/✓ recommended/)).toBeTruthy();
    // recommended label sits on the Pro row (marketing video default)
    expect(screen.getByText("Pro").parentElement?.textContent).toMatch(/recommended/);
    // confirm button defaults to Pro (8 credits)
    expect(screen.getByText(/Confirm — Pro \(8 credits\)/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/You have 120 video credits available/)).toBeTruthy());
  });

  it("tier override → confirm button updates to the chosen tier + weight", async () => {
    const onConfirm = vi.fn();
    render(<GenerationTierModal pending={{ kind: "video", department: "marketing", prompt: "x" }} onConfirm={onConfirm} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Quick"));
    expect(screen.getByText(/Confirm — Quick \(4 credits\)/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Confirm — Quick/));
    expect(onConfirm).toHaveBeenCalledWith("quick");
  });
});
