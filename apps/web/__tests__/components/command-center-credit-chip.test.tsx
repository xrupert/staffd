/**
 * T3.0 — CommandCenter credit-chip removal contract test (W14, W15).
 *
 * ARCH §12: specialist conversations are unlimited. The Phase 4 header
 * chip ("Agent credits remaining" / "{N} credits") was a §12 violation
 * and was removed in T3.0, along with its /api/credits fetch. This test
 * pins both: no credit language in the rendered header, and no network
 * call to /api/credits on mount.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CommandCenter from "../../app/components/CommandCenter";

void React;

// Unauthed PocketBase mock — CommandCenter mounts cleanly without a user
// and child components (suggestions, thread picker) skip their loads.
vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: null, isValid: false, token: "" },
    collection: () => ({ getList: async () => ({ items: [] }) }),
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommandCenter (T3.0 — no agent-credit chip)", () => {
  it("renders no credit chip and never fetches /api/credits", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      json: async () => ({}),
      body: null,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CommandCenter />);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/agent.{0,5}credit|credits remaining/i);
    expect(text).not.toMatch(/\bcredits?\b/i);

    // Give any mount-time effects a tick to fire, then verify no
    // /api/credits call was made.
    await new Promise((r) => setTimeout(r, 20));
    const creditCalls = fetchMock.mock.calls.filter((args) =>
      String(args[0]).includes("/api/credits")
    );
    expect(creditCalls).toHaveLength(0);
  });
});
