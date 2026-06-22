/**
 * W95.8 — NotificationBell: shows the unread count, opens the inbox, and marks a
 * notification read on click (straight to PB; USER_OWNED rows).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const updateSpy = vi.fn(async () => ({}));
const rows = [
  { id: "n1", type: "generation.ready", title: "Your video is ready", body: "Tap to watch.", href: "https://cdn/v.mp4", severity: "success", read: false, created: "2026-06-21T10:00:00Z" },
  { id: "n2", type: "credits.low", title: "You're low on credits", body: "2 left.", href: "/pricing", severity: "warning", read: true, created: "2026-06-20T10:00:00Z" },
];
vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "u1" }, token: "tok" },
    collection: () => ({ getList: async () => ({ items: rows }), update: updateSpy }),
  },
}));

import NotificationBell from "../../app/components/NotificationBell";

beforeEach(() => updateSpy.mockClear());
afterEach(() => cleanup());

describe("NotificationBell (W95.8)", () => {
  it("renders the unread count badge (1 of 2)", async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByLabelText("1 unread")).toBeTruthy());
  });

  it("opens the inbox and marks an unread item read on click", async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByLabelText("1 unread")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("Your video is ready")).toBeTruthy();
    fireEvent.click(screen.getByText("Your video is ready"));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("n1", { read: true }));
  });
});
