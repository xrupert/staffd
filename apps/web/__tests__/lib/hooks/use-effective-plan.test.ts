/**
 * W71.5 — useEffectivePlan hook + signOut localStorage cleanup.
 *
 * (a) Super-admin: hook returns staffd_view_as_plan from localStorage when
 *     user email matches NEXT_PUBLIC_ADMIN_EMAIL.
 * (b) Non-super-admin: hook returns realPlan even if the key is set manually
 *     (defense against client-side privilege escalation).
 * (c) signOut() removes staffd_view_as_plan from localStorage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffectivePlan } from "../../../lib/hooks/useEffectivePlan";
import { signOut } from "../../../lib/auth/signOut";

vi.mock("../../../lib/pb", () => ({
  default: {
    authStore: {
      record: { id: "u-admin", email: "admin@staffd.com" },
      isValid: true,
      token: "tok",
      clear: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAIL", "admin@staffd.com");
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useEffectivePlan + signOut — W71.5 view-as-plan", () => {
  it("(a) returns localStorage value when user is super-admin", () => {
    localStorage.setItem("staffd_view_as_plan", "agency");
    const { result } = renderHook(() => useEffectivePlan("starter"));
    expect(result.current).toBe("agency");
  });

  it("(b) returns realPlan when user is NOT super-admin (client key ignored)", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAIL", "otheradmin@staffd.com"); // mismatch
    localStorage.setItem("staffd_view_as_plan", "agency");
    const { result } = renderHook(() => useEffectivePlan("starter"));
    expect(result.current).toBe("starter");
  });

  it("(c) signOut removes staffd_view_as_plan from localStorage", () => {
    localStorage.setItem("staffd_view_as_plan", "pro");
    signOut();
    expect(localStorage.getItem("staffd_view_as_plan")).toBeNull();
  });
});
