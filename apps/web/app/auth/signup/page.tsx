"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import pb from "../../../lib/pb";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await pb.collection("users").create({ name, email, password, passwordConfirm: password });
      await pb.collection("users").authWithPassword(email, password);
      router.push("/onboarding");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
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
            Build your AI team
          </h1>
          <p className="text-sm" style={{ color: "#6060A0" }}>
            Free to start — no credit card required
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-7"
          style={{ background: "#111118", border: "1px solid #2A2A38" }}
        >
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>
                Full name
              </label>
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
            </div>

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

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>
                Password
              </label>
              <input
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
            </div>

            {error && (
              <div
                className="px-4 py-3 rounded-xl text-xs"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 rounded-xl font-semibold text-white text-sm mt-1"
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Creating account…" : "Create my account →"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm mt-6" style={{ color: "#5A5A70" }}>
          Already have an account?{" "}
          <a href="/auth/login" className="font-medium transition-colors hover:text-white" style={{ color: "#7C4FF0" }}>
            Sign in
          </a>
        </p>

        <p className="text-center text-xs mt-4" style={{ color: "#3A3A50" }}>
          By creating an account you agree to our Terms of Service
        </p>
      </div>
    </main>
  );
}
