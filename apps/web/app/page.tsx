import Image from "next/image";

export default function Home() {
  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "#09090F" }}
    >
      {/* Grid */}
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

      {/* Purple glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -55%)",
          width: "800px",
          height: "800px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(91,33,232,0.15) 0%, rgba(91,33,232,0.04) 45%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center max-w-3xl w-full">

        {/* Logo — larger */}
        <div className="mb-12">
          <Image
            src="/logo-light.png"
            alt="STAFFD"
            width={260}
            height={116}
            priority
            style={{ objectFit: "contain" }}
          />
        </div>

        {/* Hero */}
        <h1
          className="font-bold leading-tight mb-5"
          style={{ fontSize: "clamp(42px, 6vw, 72px)", color: "#F0F0F8" }}
        >
          You&apos;re{" "}
          <span style={{ color: "#5B21E8", textShadow: "0 0 40px rgba(91,33,232,0.5)" }}>
            STAFF
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#F0F0F8",
              border: "2px solid rgba(255,255,255,0.6)",
              borderRadius: "4px",
              padding: "0 0.1em",
              height: "0.85em",
              verticalAlign: "-0.06em",
              marginLeft: "0.03em",
              fontWeight: "inherit",
            }}
          >
            D
          </span>
          <span style={{ color: "#5B21E8" }}>.</span>
        </h1>

        <p
          className="font-medium mb-3"
          style={{ fontSize: "clamp(18px, 2.5vw, 24px)", color: "#9090A8" }}
        >
          Your full business team.
        </p>

        <p
          className="mb-12 max-w-xl"
          style={{ fontSize: "16px", color: "#5A5A70", lineHeight: "1.7" }}
        >
          Marketing. Sales. Legal. HR. Finance. Operations.
          <br />
          All working for you — no hiring required.
        </p>

        {/* Primary CTA only */}
        <a
          href="/auth/signup"
          className="btn-primary px-12 py-4 rounded-xl font-semibold text-white"
          style={{ fontSize: "16px" }}
        >
          Get STAFFD →
        </a>

        {/* Demo link */}
        <p className="mt-5 text-sm" style={{ color: "#3A3A50" }}>
          See it in action first →{" "}
          <a href="/demo" style={{ color: "#5B21E8" }}>
            Watch the demo
          </a>
        </p>

        {/* Sign in — quiet utility link */}
        <p className="mt-4 text-xs" style={{ color: "#2A2A40" }}>
          Already have an account?{" "}
          <a href="/auth/login" style={{ color: "#4A3A80" }}>
            Sign in
          </a>
        </p>

        {/* Department strip */}
        <div
          className="flex flex-wrap items-center justify-center gap-6 mt-16 pt-8"
          style={{ borderTop: "1px solid #1A1A28" }}
        >
          {["Marketing", "Sales", "Legal", "HR", "Finance", "Operations"].map((dept) => (
            <span key={dept} className="text-xs font-medium" style={{ color: "#3A3A50" }}>
              {dept}
            </span>
          ))}
        </div>
      </div>

      <footer className="fixed text-xs" style={{ bottom: "24px", color: "#2A2A38" }}>
        © 2026 STAFFD · urstaffd.com
      </footer>
    </main>
  );
}
