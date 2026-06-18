/**
 * W95.5 — AutomationSettings: lists eligible intents with on/off state and
 * toggles persist via the autopilot endpoints.
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/pb", () => ({ default: { authStore: { token: "tok" } } }));
import AutomationSettings from "../../app/components/AutomationSettings";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/api/autopilot/prefs")) return { ok: true, json: async () => ({ items: [{ intent_type: "create_contact", label: "Add contacts", policy: "audited", threshold: 5, streak: 2, enabled: false, enabled_at: null }] }) };
    return { ok: true, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AutomationSettings", () => {
  it("lists eligible intents with state and toggles via the enable endpoint", async () => {
    render(<AutomationSettings />);
    await waitFor(() => expect(screen.getByText("Add contacts")).toBeTruthy());
    expect(screen.getByText("Off")).toBeTruthy();
    fireEvent.click(screen.getByText("Turn on"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/autopilot/enable"))).toBe(true));
  });
});
