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
          width: "900px",
          height: "900px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(91,33,232,0.14) 0%, rgba(91,33,232,0.04) 45%, transparent 68%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center max-w-3xl w-full">

        {/* Logo — blended, no box */}
        <div className="mb-14">
          <Image
            src="/logo-light.png"
            alt="STAFFD"
            width={160}
            height={72}
            priority
            style={{ objectFit: "contain", mixBlendMode: "screen" }}
          />
        </div>

        {/* Hero */}
        <h1
          className="font-bold leading-none mb-6"
          style={{
            fontSize: "clamp(48px, 8vw, 80px)",
            color: "#F0F0F8",
            letterSpacing: "-0.03em",
          }}
        >
          You&apos;re{" "}
          <span style={{ color: "#7C4FF0", textShadow: "0 0 48px rgba(91,33,232,0.55)" }}>
            STAFF
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2.5px solid #F0F0F8",
              borderRadius: "5px",
              width: "0.72em",
              height: "0.72em",
              lineHeight: "1",
              verticalAlign: "middle",
              color: "#F0F0F8",
              fontWeight: "inherit",
              fontSize: "inherit",
              marginLeft: "0.04em",
              marginBottom: "0.08em",
            }}
          >
            D
          </span>
          <span style={{ color: "#7C4FF0" }}>.</span>
        </h1>

        {/* Subhead */}
        <p
          className="font-semibold mb-4"
          style={{ fontSize: "clamp(18px, 2.5vw, 22px)", color: "#C0B0E8", letterSpacing: "-0.01em" }}
        >
          Your full business team.
        </p>

        <p
          className="mb-12 max-w-lg"
          style={{ fontSize: "16px", color: "#5A5A70", lineHeight: "1.75" }}
        >
          Marketing. Sales. Legal. HR. Finance. Operations.
          <br />
          All covered — no hiring required.
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center gap-4">
          <a
            href="/auth/signup"
            className="btn-primary px-10 py-4 rounded-xl font-bold text-white"
            style={{ fontSize: "16px", letterSpacing: "-0.01em" }}
          >
            Get STAFFD →
          </a>
          <a
            href="/demo"
            className="text-sm transition-colors hover:text-white"
            style={{ color: "#5A5A70" }}
          >
            See it in action first →
          </a>
        </div>

        {/* Sign in */}
        <p className="mt-8 text-xs" style={{ color: "#2E2E45" }}>
          Already have an account?{" "}
          <a
            href="/auth/login"
            className="transition-colors hover:text-white"
            style={{ color: "#4A3A80" }}
          >
            Sign in
          </a>
        </p>


        {/* Department strip */}
        <div
          className="flex flex-wrap items-center justify-center gap-6 mt-16 pt-8"
          style={{ borderTop: "1px solid #161622" }}
        >
          {["Marketing", "Sales", "Legal", "HR", "Finance", "Operations"].map((dept) => (
            <span key={dept} className="text-xs font-medium" style={{ color: "#2E2E45" }}>
              {dept}
            </span>
          ))}
        </div>
      </div>

      <footer
        className="fixed text-xs"
        style={{ bottom: "24px", color: "#222230" }}
      >
        © 2026 STAFFD · urstaffd.com
      </footer>
    </main>
  );
}
