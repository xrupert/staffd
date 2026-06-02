"use client";

/**
 * Registers the STAFFD service worker on app boot.
 *
 * Mounted once from the root layout. Idempotent — `navigator.serviceWorker`
 * deduplicates registrations by scope, so this is safe across navigations.
 *
 * Skips registration in dev to keep the HMR loop unconfused.
 */

import { useEffect } from "react";

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[sw] registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
