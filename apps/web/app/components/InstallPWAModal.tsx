"use client";

/**
 * InstallPWAModal — captures the `beforeinstallprompt` event and surfaces
 * a single, dismissible install prompt on the dashboard.
 *
 * Shows at most once per session (sessionStorage). The native install UI
 * is opaque — we just trigger `prompt()` when the user clicks our button.
 *
 * Note: iOS Safari doesn't fire `beforeinstallprompt`. On iOS we don't
 * show the modal; users add to home screen via the share sheet. A future
 * follow-up could show an iOS-specific "Add to home screen" hint.
 */

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "staffd_install_prompt_dismissed_v1";

export default function InstallPWAModal() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Suppress on already-installed display mode.
    if (window.matchMedia?.("(display-mode: standalone)").matches) return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const event = e as BeforeInstallPromptEvent;
      setDeferred(event);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!open || !deferred) return null;

  async function accept() {
    try {
      await deferred?.prompt();
      await deferred?.userChoice;
    } catch { /* user cancelled */ }
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 sm:inset-auto sm:right-6 sm:bottom-6 z-40 px-4 sm:px-0 pb-4 sm:pb-0"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="rounded-2xl px-5 py-4 max-w-sm mx-auto sm:mx-0 flex items-start gap-3 shadow-2xl"
        style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.4)", pointerEvents: "auto" }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-base flex-shrink-0"
          style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.35)" }}
        >
          📱
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>
            Install STAFFD on your phone
          </p>
          <p className="text-xs mt-1" style={{ color: "#9090A8" }}>
            Get your Morning Brief at 8 AM without opening a browser.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void accept()}
              className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            >
              Install
            </button>
            <button
              onClick={dismiss}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#5A5A70" }}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
