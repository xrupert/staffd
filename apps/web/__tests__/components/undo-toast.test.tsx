/**
 * W95.5 — UndoToast: renders the message + Undo, fires the undo endpoint on
 * click, and shows the reverted state on success.
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/pb", () => ({ default: { authStore: { token: "tok" } } }));
import UndoToast from "../../app/components/UndoToast";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("UndoToast", () => {
  it("renders the message and an Undo control", () => {
    render(<UndoToast auditRowId="a1" message="Added Jane to contacts." onClose={() => {}} />);
    expect(screen.getByText("Added Jane to contacts.")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();
  });

  it("clicking Undo POSTs the undo intent and shows Reverted", async () => {
    render(<UndoToast auditRowId="a1" message="Added Jane to contacts." onClose={() => {}} />);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByText(/Reverted/)).toBeTruthy());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ intent_type: "undo", fields: { audit_row_id: "a1" } });
  });

  it("shows an honest error when the undo window has closed", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<UndoToast auditRowId="a1" message="Added Jane." onClose={() => {}} />);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByText(/activity log/)).toBeTruthy());
  });
});
