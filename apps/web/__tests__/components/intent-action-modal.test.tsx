/**
 * W95.7.1 — IntentActionModal: the FC-2 button → confirm-to-commit wrapper.
 * Proves a migrated button SHOWS the confirm modal (never a silent write) and,
 * on confirm, fires /api/intent/commit with the pre-filled intent_type.
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/pb", () => ({ default: { authStore: { token: "tok" } } }));
import IntentActionModal from "../../app/components/IntentActionModal";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ expected_completion_message: "Done." }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("IntentActionModal (W95.7.1)", () => {
  it("renders nothing when there is no pending action", () => {
    const { container } = render(<IntentActionModal pending={null} onClose={() => {}} onResult={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the ConfirmActionModal (does NOT bypass) for a pending action", () => {
    render(<IntentActionModal pending={{ type: "draft_campaign", fields: { message_summary: "Spring sale" } }} onClose={() => {}} onResult={() => {}} />);
    // The draft_campaign confirm title + a Confirm button must be present.
    expect(screen.getByText("Have Marketing draft this?")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    // No network call happened just by opening — the user must confirm first.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on Confirm, fires /api/intent/commit with the pre-filled intent_type + source ui", async () => {
    const onResult = vi.fn();
    const onClose = vi.fn();
    render(<IntentActionModal pending={{ type: "create_contact", fields: { name: "Jane", context: "from a deliverable" } }} onClose={onClose} onResult={onResult} />);
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/intent/commit");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ intent_type: "create_contact", source: "ui" });
    expect(body.fields).toMatchObject({ name: "Jane" });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("Done.", true));
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel closes without committing", () => {
    const onClose = vi.fn();
    render(<IntentActionModal pending={{ type: "create_contact", fields: { name: "Jane" } }} onClose={onClose} onResult={() => {}} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failure honestly via onResult(false)", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    const onResult = vi.fn();
    render(<IntentActionModal pending={{ type: "draft_campaign", fields: { message_summary: "x" } }} onClose={() => {}} onResult={onResult} />);
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.stringMatching(/try/i), false));
  });
});
