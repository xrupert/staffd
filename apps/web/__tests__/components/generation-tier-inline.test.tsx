/**
 * W95.7.3d-h2 — GenerationTierInline: the same tier-gate as GenerationTierModal
 * but rendered INLINE in the CommandCenter conversation stream (no overlay /
 * backdrop), per ratified D2(a). It renders from the shared buildTierOptions
 * source, so its tiers/weights/recommended/labels match the modal exactly.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/pb", () => ({ default: { authStore: { record: { id: "u1" }, token: "tok" } } }));
import GenerationTierInline from "../../app/components/GenerationTierInline";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ totalRemaining: { video: 120, image: 9 } }) }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("GenerationTierInline (W95.7.3d-h2)", () => {
  it("renders three tiers, marketing-video default (Pro) recommended, balance footer", async () => {
    render(<GenerationTierInline pending={{ kind: "video", department: "marketing", prompt: "x" }} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Quick")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    expect(screen.getByText("Premium")).toBeTruthy();
    expect(screen.getByText("Pro").parentElement?.textContent).toMatch(/recommended/);
    expect(screen.getByText(/Confirm — Pro \(8 credits\)/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/You have 120 video credits available/)).toBeTruthy());
  });

  it("tier override → confirm button updates + fires onConfirm with the chosen tier", () => {
    const onConfirm = vi.fn();
    render(<GenerationTierInline pending={{ kind: "image", department: "operations", prompt: "x" }} onConfirm={onConfirm} onClose={() => {}} />);
    // operations image default is Quick (1 credit)
    expect(screen.getByText(/Confirm — Quick \(1 credit\)/)).toBeTruthy();
    fireEvent.click(screen.getByText("Premium"));
    expect(screen.getByText(/Confirm — Premium \(4 credits\)/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Confirm — Premium/));
    expect(onConfirm).toHaveBeenCalledWith("premium");
  });

  it("returns null when there is no pending request", () => {
    const { container } = render(<GenerationTierInline pending={null} onConfirm={() => {}} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
