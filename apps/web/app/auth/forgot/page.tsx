"use client";

/**
 * /auth/forgot — password reset request (fixes the login page's dead
 * "Forgot?" link, which 404'd because this page never existed).
 *
 * Posts PB's requestPasswordReset and ALWAYS shows the same success state
 * regardless of whether the email exists (no account enumeration). The
 * reset email itself is sent by PocketBase — requires PB SMTP to be
 * configured (ACTIVATE.md Phase 0); until then the request succeeds but
 * no email arrives, which is a PB-config matter, not a UI one.
 */

import Image from "next/image";
import { useState } from "react";
import pb from "../../../lib/pb";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      await pb.collection("users").requestPasswordReset(email);
    } catch {
      /* deliberately identical outcome — never reveal whether the email exists */
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6 py-16"
      style={{ background: "#09090F" }}
    >
      {/* Grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />
      {/* Glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: "-100px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.13) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <a href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={110} height={48} style={{ objectFit: "contain" }} />
          </a>
        </div>

        {/* Headline */}
        <div className="text-center mb-8">
          <h1
            className="font-bold mb-2"
            style={{ color: "#F0F0F8", fontSize: "1.875rem", lineHeight: 1.15, letterSpacing: "-0.02em" }}
          >
            Reset your password
          </h1>
          <p className="text-sm" style={{ color: "#6060A0" }}>
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{ background: "#111118", border: "1px solid #2A2A38" }}
        >
          {sent ? (
            <div className="text-center py-2">
              <p className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>
                Check your inbox
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "#6060A0" }}>
                If an account exists for {email || "that address"}, a password
                reset link is on its way. It can take a minute or two.
              </p>
              <a
                href="/auth/login"
                className="inline-block mt-5 text-xs font-semibold transition-colors hover:text-white"
                style={{ color: "#5B21E8" }}
              >
                ← Back to sign in
              </a>
            </div>
          ) : (
            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>
                  Email
                </label>
                <input
                  type="email"
                  placeholder="you@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                  style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: "#5B21E8", opacity: loading ? 0.6 : 1, cursor: loading ? "wait" : "pointer" }}
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>

              <p className="text-center text-xs" style={{ color: "#6060A0" }}>
                Remembered it?{" "}
                <a href="/auth/login" className="font-semibold transition-colors hover:text-white" style={{ color: "#5B21E8" }}>
                  Sign in
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
