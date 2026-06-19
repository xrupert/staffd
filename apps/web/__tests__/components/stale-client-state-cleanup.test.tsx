/**
 * W95.7.3a — StaleClientStateCleanup removes the orphaned `staffd_active_client`
 * key on mount (Standard #30 — a hidden UI must clear its state) and is
 * idempotent (safe when the key is already absent).
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import StaleClientStateCleanup from "../../app/components/StaleClientStateCleanup";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("StaleClientStateCleanup (W95.7.3a)", () => {
  it("removes a stale staffd_active_client key on mount", () => {
    localStorage.setItem("staffd_active_client", "client_abc123");
    expect(localStorage.getItem("staffd_active_client")).toBe("client_abc123");
    const { container } = render(<StaleClientStateCleanup />);
    expect(localStorage.getItem("staffd_active_client")).toBeNull(); // cleared
    expect(container.firstChild).toBeNull(); // renders nothing
  });

  it("is idempotent — no throw and no-op when the key is already absent", () => {
    expect(localStorage.getItem("staffd_active_client")).toBeNull();
    expect(() => render(<StaleClientStateCleanup />)).not.toThrow();
    expect(localStorage.getItem("staffd_active_client")).toBeNull();
  });
});
