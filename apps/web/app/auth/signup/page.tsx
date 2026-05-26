import Image from "next/image";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      {/* Grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(91, 33, 232, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(91, 33, 232, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />
      <div
        className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(91, 33, 232, 0.1) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <a href="/" className="flex items-center justify-center mb-10">
          <Image src="/logo-dark.png" alt="STAFFD" width={120} height={54} style={{ objectFit: "contain" }} />
        </a>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{ background: "#111118", border: "1px solid #2A2A38" }}
        >
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8" }}>
            Get STAFFD
          </h1>
          <p className="text-sm mb-8" style={{ color: "#9090A8" }}>
            Your AI-powered business team is ready.
          </p>

          <form className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: "#9090A8" }}>
                Full name
              </label>
              <input
                type="text"
                placeholder="Chris Rupert"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: "#1A1A24",
                  border: "1px solid #2A2A38",
                  color: "#F0F0F8",
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: "#9090A8" }}>
                Email
              </label>
              <input
                type="email"
                placeholder="you@business.com"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: "#1A1A24",
                  border: "1px solid #2A2A38",
                  color: "#F0F0F8",
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: "#9090A8" }}>
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
                style={{
                  background: "#1A1A24",
                  border: "1px solid #2A2A38",
                  color: "#F0F0F8",
                }}
              />
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-3 rounded-lg font-semibold text-white mt-2"
            >
              Create my account
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: "#5A5A70" }}>
            Already have an account?{" "}
            <a href="/auth/login" style={{ color: "#5B21E8" }}>
              Sign in
            </a>
          </p>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "#5A5A70" }}>
          By signing up you agree to our Terms · No credit card required
        </p>
      </div>
    </main>
  );
}
