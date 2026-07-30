"use client";

/**
 * PR-UX-3 — Escape closes any modal (Jakob's law: every modal on the
 * web closes on Escape; none of ours did). One hook, applied per modal.
 */

import { useEffect } from "react";

export function useEscapeClose(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, active]);
}
