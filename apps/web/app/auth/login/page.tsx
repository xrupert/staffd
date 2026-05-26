export default function LoginPage() {
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
        <a href="/" className="flex items-center justify-center gap-3 mb-10">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr 1fr", gap: "2px", width: "28px", height: "34px" }}>
            <div style={{ background: "#8892A4", borderRadius: "2px" }} />
            <div style={{ background: "#5B21E8", borderRadius: "2px" }} />
            <div style={{ background: "#5A6478", borderRadius: "2px" }} />
            <div style={{ background: "#A0AABC", borderRadius: "2px" }} />
            <div style={{ background: "#3D4455", borderRadius: "2px" }} />
            <div style={{ background: "#C0CADC", borderRadius: "2px" }} />
          </div>
          <span className="text-xl font-bold tracking-widest" style={{ color: "#F0F0F8" }}>
            STAFF<span style={{ border: "2px solid #5B21E8", padding: "0 3px", borderRadius: "3px" }}>D</span>
          </span>
        </a>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{ background: "#111118", border: "1px solid #2A2A38" }}
        >
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8" }}>
            Welcome back
          </h1>
          <p className="text-sm mb-8" style={{ color: "#9090A8" }}>
            Sign in to your STAFFD account.
          </p>

          <form className="flex flex-col gap-4">
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
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" style={{ color: "#9090A8" }}>
                  Password
                </label>
                <a href="/auth/forgot" className="text-xs" style={{ color: "#5B21E8" }}>
                  Forgot password?
                </a>
              </div>
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
              Sign in
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: "#5A5A70" }}>
            Don&apos;t have an account?{" "}
            <a href="/auth/signup" style={{ color: "#5B21E8" }}>
              Get STAFFD free
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
