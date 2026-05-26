export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
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

      {/* Purple glow */}
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: "600px",
          height: "600px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(91, 33, 232, 0.12) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 text-center max-w-2xl">
        {/* Logo mark */}
        <div className="flex items-center justify-center gap-1 mb-8">
          <div className="grid grid-cols-2 gap-0.5 w-10 h-10">
            <div style={{ background: "#6B7280", borderRadius: "2px" }} />
            <div style={{ background: "#5B21E8", borderRadius: "2px" }} />
            <div style={{ background: "#374151", borderRadius: "2px" }} />
            <div style={{ background: "#9CA3AF", borderRadius: "2px" }} />
          </div>
          <span className="text-3xl font-bold tracking-widest ml-3" style={{ color: "#F0F0F8" }}>
            STAFF<span
              style={{
                border: "2px solid #5B21E8",
                color: "#F0F0F8",
                padding: "0 4px",
                borderRadius: "3px",
              }}
            >D</span>
          </span>
        </div>

        <h1
          className="text-5xl font-bold mb-4 leading-tight"
          style={{ color: "#F0F0F8" }}
        >
          You&apos;re{" "}
          <span style={{ color: "#5B21E8" }}>STAFFD.</span>
        </h1>

        <p
          className="text-xl mb-2"
          style={{ color: "#9090A8" }}
        >
          Your AI-powered business team.
        </p>
        <p
          className="text-base mb-12"
          style={{ color: "#5A5A70" }}
        >
          Marketing. Sales. Legal. HR. Finance. All working for you — no hiring required.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="/auth/signup"
            className="px-8 py-3 rounded-lg font-semibold text-white transition-all"
            style={{
              background: "#5B21E8",
              boxShadow: "0 0 24px rgba(91, 33, 232, 0.4)",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#7C4FF0";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#5B21E8";
            }}
          >
            Get STAFFD — Free to start
          </a>
          <a
            href="/auth/login"
            className="px-8 py-3 rounded-lg font-semibold transition-all"
            style={{
              border: "1px solid #2A2A38",
              color: "#9090A8",
            }}
          >
            Sign in
          </a>
        </div>

        <p className="mt-8 text-sm" style={{ color: "#5A5A70" }}>
          No credit card required · Cancel anytime · Your data stays yours
        </p>
      </div>

      <footer
        className="fixed bottom-6 text-sm"
        style={{ color: "#5A5A70" }}
      >
        © 2026 STAFFD · urstaffd.com
      </footer>
    </main>
  );
}
