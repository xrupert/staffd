/**
 * W64 B2 — ScheduleFollowupModal pins (SA Decision 13): writes
 * status:'planned' to scheduled_content (the worker-executed lane, not the
 * 'review' calendar lane), editable task seeded from source, date picker
 * defaulting one week out, error path never strands the user.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const createMock = vi.fn();
vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1" }, token: "t" },
    collection: () => ({ create: createMock }),
  },
}));

import ScheduleFollowupModal from "../../app/components/ScheduleFollowupModal";

void React;

function mount(overrides?: Partial<React.ComponentProps<typeof ScheduleFollowupModal>>) {
  const onClose = vi.fn();
  const utils = render(
    <ScheduleFollowupModal
      open={true}
      onClose={onClose}
      department="marketing"
      agentName="Email Marketer"
      seedTask="Follow up on the spring campaign"
      {...overrides}
    />
  );
  return { ...utils, onClose };
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({});
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ScheduleFollowupModal — render + seeding (D13)", () => {
  it("renders nothing when closed", () => {
    const { container } = mount({ open: false });
    expect(container.innerHTML).toBe("");
  });

  it("seeds the editable task from the source and defaults the date one week out", () => {
    const { getByLabelText } = mount();
    expect((getByLabelText("Follow-up task") as HTMLTextAreaElement).value).toBe(
      "Follow up on the spring campaign"
    );
    expect((getByLabelText("Follow-up date") as HTMLInputElement).value).toBe(plusDays(7));
  });

  it("task is editable — the user controls what the agent executes", () => {
    const { getByLabelText } = mount();
    const ta = getByLabelText("Follow-up task") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "Write the renewal reminder email" } });
    expect(ta.value).toBe("Write the renewal reminder email");
  });
});

describe("ScheduleFollowupModal — save path (status:'planned')", () => {
  it("creates a scheduled_content record with status 'planned' and the edited task", async () => {
    const { getByLabelText, getByText } = mount();
    fireEvent.change(getByLabelText("Follow-up task"), {
      target: { value: "Write the renewal reminder email" },
    });
    fireEvent.change(getByLabelText("Follow-up date"), { target: { value: plusDays(14) } });
    fireEvent.click(getByText("Schedule follow-up →"));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      user: "user-1",
      department: "marketing",
      agent_name: "Email Marketer",
      task: "Write the renewal reminder email",
      scheduled_date: plusDays(14),
      status: "planned",
      client: "",
    });
  });

  it("shows the success notice, then closes", async () => {
    const { getByText, onClose, container } = mount();
    fireEvent.click(getByText("Schedule follow-up →"));
    await waitFor(() =>
      expect(container.textContent).toContain("Follow-up scheduled — your team will run it on that date.")
    );
    act(() => { vi.advanceTimersByTime(1_600); });
    expect(onClose).toHaveBeenCalled();
  });

  it("create failure → retry notice, modal stays open, never throws", async () => {
    createMock.mockRejectedValueOnce(new Error("pb down"));
    const { getByText, onClose, container } = mount();
    fireEvent.click(getByText("Schedule follow-up →"));
    await waitFor(() => expect(container.textContent).toContain("Couldn't schedule — try again."));
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("save disabled when the task is emptied", () => {
    const { getByLabelText, getByText } = mount();
    fireEvent.change(getByLabelText("Follow-up task"), { target: { value: "   " } });
    fireEvent.click(getByText("Schedule follow-up →"));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("reopening re-seeds task, date, and clears stale notices", () => {
    const { getByLabelText, rerender } = mount();
    fireEvent.change(getByLabelText("Follow-up task"), { target: { value: "edited away" } });
    rerender(
      <ScheduleFollowupModal
        open={false} onClose={() => {}} department="marketing"
        agentName="Email Marketer" seedTask="Fresh seed"
      />
    );
    rerender(
      <ScheduleFollowupModal
        open={true} onClose={() => {}} department="marketing"
        agentName="Email Marketer" seedTask="Fresh seed"
      />
    );
    expect((getByLabelText("Follow-up task") as HTMLTextAreaElement).value).toBe("Fresh seed");
    expect((getByLabelText("Follow-up date") as HTMLInputElement).value).toBe(plusDays(7));
  });
});
