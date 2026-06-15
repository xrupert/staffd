"use client";

/**
 * GoogleAuthButton (FC-4) — "Continue with Google" for login + signup.
 *
 * Uses PocketBase's all-in-one OAuth2 flow (`authWithOAuth2`), which opens
 * the Google consent popup, exchanges the code, and creates the user record
 * on first sign-in. Brand-new accounts route to onboarding (so VaultContext
 * gets populated); returning accounts go straight to the dashboard.
 *
 * Requires the Google OAuth2 provider to be enabled in the PocketBase admin
 * (Settings → Auth providers). Until then the button surfaces a friendly
 * "not configured yet" message rather than a raw SDK error.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import pb from "../../lib/pb";

/** Where to send the user after a successful Google auth. */
export function oauthNextRoute(isNew: boolean): string {
  return isNew ? "/onboarding" : "/dashboard";
}

export default function GoogleAuthButton({ label = "Continue with Google" }: { label?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setLoading(true);
    try {
      const authData = await pb.collection("users").authWithOAuth2({ provider: "google" });
      const isNew = (authData as { meta?: { isNew?: boolean } }).meta?.isNew === true;
      router.push(oauthNextRoute(isNew));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      // PB returns this when the provider isn't enabled in admin yet.
      if (/provider|not.*found|missing/i.test(msg)) {
        setError("Google sign-in isn't enabled yet. Use email for now.");
      } else if (/cancel|closed|abort/i.test(msg)) {
        setError(""); // user closed the popup — not an error worth showing
      } else {
        setError("Couldn't sign in with Google. Try again or use email.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={loading}
        className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-3 transition-all"
        style={{
          background: "#FFFFFF",
          color: "#1A1A24",
          border: "1px solid #2A2A38",
          opacity: loading ? 0.7 : 1,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        <GoogleGlyph />
        {loading ? "Connecting…" : label}
      </button>

      {error && (
        <div
          className="px-4 py-2.5 rounded-xl text-xs"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}
        >
          {error}
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px" style={{ background: "#2A2A38" }} />
        <span className="text-xs" style={{ color: "#3A3A50" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "#2A2A38" }} />
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
