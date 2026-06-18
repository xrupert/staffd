/**
 * W95.6 — /dashboard/front-desk/inbox: lists conversations, opens a drawer with
 * the thread (oldest-first), and shows a DISABLED Reply (Standard #21).
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/pb", () => ({ default: { authStore: { token: "tok" } } }));
import InboxPage from "../../app/dashboard/front-desk/inbox/page";

function stub(conversations: unknown[], messages: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (/\/api\/front-desk\/inbox\/\d+/.test(url)) return { ok: true, json: async () => ({ messages }) };
    if (url.includes("/api/front-desk/inbox")) return { ok: true, json: async () => ({ conversations }) };
    return { ok: true, json: async () => ({}) };
  }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("InboxPage", () => {
  beforeEach(() => stub(
    [{ id: 7, sender: "Acme Co", snippet: "where is my order", status: "open", lastAt: "2026-06-01" }],
    [{ id: 2, content: "we're on it", outgoing: true, createdAt: "2026-06-01T10:01:00Z" }, { id: 1, content: "where is my order", outgoing: false, createdAt: "2026-06-01T10:00:00Z" }],
  ));

  it("renders the open conversations", async () => {
    render(<InboxPage />);
    await waitFor(() => expect(screen.getByText("Acme Co")).toBeTruthy());
  });

  it("opens a drawer with the thread and a disabled Reply", async () => {
    render(<InboxPage />);
    await waitFor(() => expect(screen.getByText("Acme Co")).toBeTruthy());
    fireEvent.click(screen.getByText("Acme Co"));
    await waitFor(() => expect(screen.getByText("we're on it")).toBeTruthy());
    const reply = screen.getByText(/Reply/);
    expect((reply as HTMLButtonElement).disabled).toBe(true);
    expect(reply.getAttribute("title")).toMatch(/coming/i);
  });

  it("shows the STAFFD-voice empty state (no vendor name) when clear", async () => {
    cleanup();
    stub([], []);
    render(<InboxPage />);
    await waitFor(() => expect(screen.getByText(/Inbox clear/)).toBeTruthy());
    expect(screen.queryByText(/Chatwoot/i)).toBeNull();
  });
});
