"use client";

/**
 * PlausibleScript — analytics tracking with super-admin opt-out (W72).
 *
 * Loads the Plausible script for customer sessions only. Operator +
 * super-admin sessions are NOT counted as customer traffic: when the authed
 * email matches NEXT_PUBLIC_ADMIN_EMAIL we skip the script and install a
 * window.plausible no-op so any inline event calls don't crash.
 *
 * Client-only by design — the decision depends on the PB auth store, which
 * lives in the browser. Gated behind a mounted flag so SSR never emits the
 * script (no hydration mismatch); the script is injected after mount, which
 * matches Plausible's deferred/afterInteractive loading anyway.
 */

import { useEffect, useState } from "react";
import Script from "next/script";
import pb from "../../lib/pb";
import { isSuperAdminClient } from "../../lib/hooks/useEffectivePlan";
import { resolvePlausibleDomain } from "../../lib/env";

export default function PlausibleScript() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isAdmin = mounted && isSuperAdminClient((pb.authStore.record as { email?: string } | null)?.email);

  useEffect(() => {
    if (!isAdmin || typeof window === "undefined") return;
    const w = window as unknown as { plausible?: (...args: unknown[]) => void };
    if (!w.plausible) w.plausible = () => {};
  }, [isAdmin]);

  const plausibleUrl = process.env.NEXT_PUBLIC_PLAUSIBLE_URL;
  if (!plausibleUrl || !mounted || isAdmin) return null;

  return (
    <Script
      defer
      data-domain={resolvePlausibleDomain()}
      src={`${plausibleUrl}/js/script.js`}
      strategy="afterInteractive"
    />
  );
}
