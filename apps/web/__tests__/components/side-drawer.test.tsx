/**
 * W95.4b — SideDrawer: renders children when open, closes on backdrop click +
 * Escape, renders nothing when closed.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import SideDrawer from "../../app/components/SideDrawer";

afterEach(cleanup);

describe("SideDrawer", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SideDrawer open={false} title="X" onClose={() => {}}><p>body</p></SideDrawer>);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders title + children when open", () => {
    render(<SideDrawer open title="Task detail" onClose={() => {}}><p>the body</p></SideDrawer>);
    expect(screen.getByText("Task detail")).toBeTruthy();
    expect(screen.getByText("the body")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<SideDrawer open title="X" onClose={onClose}><p>b</p></SideDrawer>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click but not on panel click", () => {
    const onClose = vi.fn();
    render(<SideDrawer open title="X" onClose={onClose}><p>panel-body</p></SideDrawer>);
    fireEvent.click(screen.getByText("panel-body")); // inside the panel → stopPropagation
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog")); // backdrop
    expect(onClose).toHaveBeenCalled();
  });
});
