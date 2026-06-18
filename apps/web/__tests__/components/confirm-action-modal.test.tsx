/**
 * W95.4b — ConfirmActionModal: single editable mode + two-option
 * disambiguation chooser.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import ConfirmActionModal, { type IntentResult } from "../../app/components/ConfirmActionModal";

afterEach(cleanup);

describe("ConfirmActionModal — single mode", () => {
  it("renders the intent fields and confirms with (type, fields)", () => {
    const onConfirm = vi.fn();
    const intent: IntentResult = { type: "create_contact", fields: { name: "Jane", email: "j@x.com" }, confidence: 0.9 };
    render(<ConfirmActionModal intentOptions={[intent]} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByText("Add this contact?")).toBeTruthy();
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("create_contact", expect.objectContaining({ name: "Jane" }));
  });

  it("disables Confirm until the required field is present", () => {
    const onConfirm = vi.fn();
    render(<ConfirmActionModal intentOptions={[{ type: "create_task", fields: { title: "" }, confidence: 0.9 }]} onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).not.toHaveBeenCalled(); // required `title` empty → gated
  });
});

describe("ConfirmActionModal — graduation offer (W95.5)", () => {
  it("renders the three graduation buttons and reports the chosen path", () => {
    const onGraduate = vi.fn();
    render(<ConfirmActionModal intentOptions={[{ type: "create_contact", fields: { name: "Jane" }, confidence: 0.9 }]} showGraduationOffer graduationCount={5} onConfirm={() => {}} onGraduate={onGraduate} onCancel={() => {}} />);
    expect(screen.getByText("Yes, automate it")).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
    expect(screen.getByText("Just this once")).toBeTruthy();
    fireEvent.click(screen.getByText("Yes, automate it"));
    expect(onGraduate).toHaveBeenCalledWith("yes", "create_contact", expect.objectContaining({ name: "Jane" }));
  });
  it("does not render the offer block when showGraduationOffer is false", () => {
    render(<ConfirmActionModal intentOptions={[{ type: "create_contact", fields: { name: "Jane" }, confidence: 0.9 }]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Yes, automate it")).toBeNull();
    expect(screen.getByText("Confirm")).toBeTruthy();
  });
});

describe("ConfirmActionModal — two-option disambiguation", () => {
  it("renders both verbs and commits the chosen option's own fields", () => {
    const onConfirm = vi.fn();
    const options: IntentResult[] = [
      { type: "capture_lead", fields: { name: "John", company: "Acme" }, confidence: 0.82 },
      { type: "create_contact", fields: { name: "John" }, confidence: 0.78 },
    ];
    render(<ConfirmActionModal intentOptions={options} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByText("Capture as lead")).toBeTruthy();
    expect(screen.getByText("Just add contact")).toBeTruthy();
    fireEvent.click(screen.getByText("Just add contact"));
    expect(onConfirm).toHaveBeenCalledWith("create_contact", { name: "John" });
  });
});
