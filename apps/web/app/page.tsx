export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "#09090F" }}
    >
      {/* Grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(91, 33, 232, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(91, 33, 232, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Purple glow — large, centered */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -55%)",
          width: "800px",
          height: "800px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(91, 33, 232, 0.15) 0%, rgba(91, 33, 232, 0.04) 45%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center max-w-3xl w-full">

        {/* Logo mark — 6-block grid matching brand */}
        <div className="flex items-center gap-4 mb-12">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gridTemplateRows: "1fr 1fr 1fr",
              gap: "3px",
              width: "44px",
              height: "52px",
            }}
          >
            <div style={{ background: "#8892A4", borderRadius: "3px" }} />
            <div style={{ background: "#5B21E8", borderRadius: "3px" }} />
            <div style={{ background: "#5A6478", borderRadius: "3px" }} />
            <div style={{ background: "#A0AABC", borderRadius: "3px" }} />
            <div style={{ background: "#3D4455", borderRadius: "3px" }} />
            <div style={{ background: "#C0CADC", borderRadius: "3px" }} />
          </div>
          <span
            className="font-bold tracking-widest"
            style={{ fontSize: "28px", color: "#F0F0F8", letterSpacing: "0.15em" }}
          >
            STAFF<span
              style={{
                border: "2.5px solid #5B21E8",
                color: "#F0F0F8",
                padding: "1px 5px",
                borderRadius: "4px",
              }}
            >D</span>
          </span>
        </div>

        {/* Hero */}
        <h1
          className="font-bold leading-tight mb-5"
          style={{ fontSize: "clamp(42px, 6vw, 72px)", color: "#F0F0F8" }}
        >
          You&apos;re{" "}
          <span
            style={{
              color: "#5B21E8",
              textShadow: "0 0 40px rgba(91, 33, 232, 0.5)",
            }}
          >
            STAFFD.
          </span>
        </h1>

        <p
          className="font-medium mb-3"
          style={{ fontSize: "clamp(18px, 2.5vw, 24px)", color: "#9090A8" }}
        >
          Your AI-powered business team.
        </p>

        <p
          className="mb-12 max-w-xl"
          style={{ fontSize: "16px", color: "#5A5A70", lineHeight: "1.7" }}
        >
          Marketing. Sales. Legal. HR. Finance. Operations.
          <br />
          All working for you — no hiring required.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
          <a
            href="/auth/signup"
            className="btn-primary flex-1 py-4 rounded-xl font-semibold text-white text-center"
            style={{ fontSize: "16px" }}
          >
            Get STAFFD free
          </a>
          <a
            href="/auth/login"
            className="btn-secondary flex-1 py-4 rounded-xl font-semibold text-center"
            style={{ fontSize: "16px" }}
          >
            Sign in
          </a>
        </div>

        <p className="mt-6 text-sm" style={{ color: "#3A3A50" }}>
          No credit card required · Cancel anytime · Your data stays yours
        </p>

        {/* Trust badges */}
        <div
          className="flex items-center gap-6 mt-16 pt-8"
          style={{ borderTop: "1px solid #1A1A28" }}
        >
          {["Marketing", "Sales", "Legal", "HR", "Finance"].map((dept) => (
            <span key={dept} className="text-xs font-medium" style={{ color: "#3A3A50" }}>
              {dept}
            </span>
          ))}
        </div>
      </div>

      <footer
        className="fixed bottom-6 text-xs"
        style={{ color: "#2A2A38" }}
      >
        © 2026 STAFFD · urstaffd.com
      </footer>
    </main>
  );
}
