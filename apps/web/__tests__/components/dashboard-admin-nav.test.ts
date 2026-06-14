/**
 * W71.5 — Admin nav visibility in dashboard header.
 *
 * isSuperAdminClient() drives the Admin link show/hide in dashboard/page.tsx.
 * These tests verify the two visibility states: absent for non-admin,
 * present (function returns true) for the configured super-admin email.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { isSuperAdminClient } from "../../lib/hooks/useEffectivePlan";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard Admin nav — W71.5 super-admin visibility", () => {
  it("Admin nav hidden: isSuperAdminClient returns false when email does not match NEXT_PUBLIC_ADMIN_EMAIL", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAIL", "admin@staffd.com");
    expect(isSuperAdminClient("regular@user.com")).toBe(false);
  });

  it("Admin nav visible: isSuperAdminClient returns true when email matches NEXT_PUBLIC_ADMIN_EMAIL", () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAIL", "admin@staffd.com");
    expect(isSuperAdminClient("admin@staffd.com")).toBe(true);
  });
});
