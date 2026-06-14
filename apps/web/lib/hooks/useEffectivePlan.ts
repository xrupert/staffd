"use client";

/**
 * useEffectivePlan — W71.5 super-admin view-as-plan hook.
 *
 * Returns staffd_view_as_plan from localStorage when the current user is the
 * configured super-admin AND the key holds a valid plan string. Otherwise
 * returns the caller's real plan unchanged. Syncs across tabs via the
 * native "storage" event.
 *
 * Server-side gating is unaffected — this is purely a presentation override.
 */

import { useEffect, useState } from "react";
import pb from "../pb";

export const VALID_PLANS = ["starter", "growth", "pro", "agency"] as const;
export type Plan = (typeof VALID_PLANS)[number];

/**
 * Returns true if the given email (or, when omitted, the current PB auth
 * store email) matches NEXT_PUBLIC_ADMIN_EMAIL. Case-insensitive; returns
 * false when the env var is unset or empty (safe default: hide admin surfaces).
 */
export function isSuperAdminClient(email?: string | null): boolean {
  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) return false;
  const userEmail = (
    email ??
    (pb.authStore.record as { email?: string } | null)?.email
  )
    ?.trim()
    .toLowerCase();
  return !!userEmail && userEmail === adminEmail;
}

export function useEffectivePlan(realPlan: Plan | null): Plan | null {
  const [effective, setEffective] = useState<Plan | null>(realPlan);

  useEffect(() => {
    function resolve() {
      if (!isSuperAdminClient()) {
        setEffective(realPlan);
        return;
      }
      const stored = localStorage.getItem("staffd_view_as_plan");
      if (stored && (VALID_PLANS as readonly string[]).includes(stored)) {
        setEffective(stored as Plan);
      } else {
        setEffective(realPlan);
      }
    }

    resolve();
    window.addEventListener("storage", resolve);
    return () => window.removeEventListener("storage", resolve);
  }, [realPlan]);

  return effective;
}
