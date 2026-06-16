import Image from "next/image";
import Link from "next/link";

// ─── Data ────────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { icon: "📣", name: "Marketing",   count: 16, example: "Q3 campaign brief, social calendar, ad copy" },
  { icon: "🤝", name: "Sales",       count: 10, example: "Cold outreach sequences, proposal drafts, objection handling" },
  { icon: "⚖️", name: "Legal",       count: 6,  example: "NDAs, service agreements, compliance review" },
  { icon: "👥", name: "HR",          count: 4,  example: "Job descriptions, onboarding plans, performance reviews" },
  { icon: "💰", name: "Finance",     count: 7,  example: "P&L snapshots, budget models, pricing strategy" },
  { icon: "⚙️", name: "Operations",  count: 12, example: "SOPs, vendor selection, workflow automation" },
  { icon: "📈", name: "Paid Media",  count: 7,  example: "Campaign strategy, budget allocation, ad creative" },
  { icon: "🎨", name: "Design",      count: 8,  example: "Brand guidelines, image generation, visual direction" },
  { icon: "🛡️", name: "Reputation", count: 5,  example: "Review responses, crisis messaging, community management" },
  { icon: "🧭", name: "The CEO",     count: 8,  example: "Weekly priorities, cross-dept synthesis, growth strategy" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Tell us about your business",
    body: "Your industry, your customers, your goals. Every specialist reads this before they start — so their first output is already tailored to your business, not a generic template.",
  },
  {
    step: "02",
    title: "Walk into any department",
    body: "Pick Marketing, Sales, Legal, or any of the 10 departments. Describe what you need in plain language. The right specialist is automatically assigned — you never have to choose between agents.",
  },
  {
    step: "03",
    title: "Get finished work — instantly",
    body: "Not a prompt. Not a starting point. Your specialist delivers finished work: the email, the contract, the campaign brief, the financial model. Ready to use or send.",
  },
];

const FEATURES = [
  {
    icon: "🧠",
    title: "The Business Vault",
    body: "Your staff remembers everything they've produced — and learns from it. Every document, every decision, every outcome becomes context for the next task. The longer you work with your team, the sharper they get.",
  },
  {
    icon: "🧭",
    title: "The CEO",
    body: "A strategic advisor who reads the work of every other department and synthesizes across them. Ask what you should focus on this week and you get an answer that cites real work from Marketing, Sales, Finance, and Operations.",
  },
  {
    icon: "🎨",
    title: "Media Studio",
    body: "Brief your Design team in plain language and get back real HD images and videos — not mockups. Social posts, product visuals, ads, brand assets. Generated, revised, and delivered by your creative staff.",
  },
  {
    icon: "🔗",
    title: "Integrations",
    body: "Your staff sends contracts for e-signature, creates CRM records, fires off email campaigns, and opens support tickets — all without leaving STAFFD.",
  },
];

const TRUST_ITEMS = [
  { icon: "🔒", title: "Your data never trains AI", body: "We use Claude via Anthropic's API. Anthropic does not train on API data. Your business information, your work, your vault — never used to train any model." },
  { icon: "💳", title: "7-day money-back guarantee", body: "If STAFFD isn't right for your business within 7 days, we'll refund you. No questions. No forms. One email to hello@urstaffd.com." },
  { icon: "🎯", title: "3 free trial runs per department", body: "Every department you haven't hired yet gives you 3 free runs so you can test the staff before committing. No credit card required for trial runs." },
  { icon: "❌", title: "Cancel any time", body: "No annual lock-ins, no cancellation fees, no 'talk to sales' to downgrade. You're in control of your subscription from the moment you sign up." },
];

// ─── Sections ─────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4"
      style={{
        background: "rgba(9,9,15,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(42,42,56,0.6)",
      }}
    >
      <Link href="/">
        <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} priority />
      </Link>
      <div className="flex items-center gap-6">
        <Link href="/pricing" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>
          Pricing
        </Link>
        <Link href="/auth/login" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>
          Sign in
        </Link>
        <Link
          href="/auth/signup"
          className="btn-primary text-xs font-semibold px-4 py-2 rounded-lg text-white"
          style={{ textDecoration: "none" }}
        >
          Get started →
        </Link>
      </div>
    </nav>
  );
}

function ProductMock() {
  return (
    <div
      className="relative w-full max-w-2xl mx-auto rounded-2xl overflow-hidden"
      style={{
        background: "#09090F",
        border: "1px solid #2A2A38",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(91,33,232,0.1), 0 0 80px rgba(91,33,232,0.08)",
      }}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #1A1A24" }}>
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#EF4444", opacity: 0.7 }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#F59E0B", opacity: 0.7 }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#22C55E", opacity: 0.7 }} />
        <span className="mx-auto text-xs font-medium" style={{ color: "#3A3A50" }}>STAFFD — Marketing</span>
      </div>

      {/* Dept tabs */}
      <div className="flex items-center gap-1 px-4 py-2.5 overflow-x-auto" style={{ borderBottom: "1px solid #1A1A24" }}>
        {["Marketing", "Sales", "Legal", "HR", "Finance", "Operations"].map((d, i) => (
          <span
            key={d}
            className="text-xs px-3 py-1 rounded-md whitespace-nowrap"
            style={{
              background: i === 0 ? "rgba(91,33,232,0.2)" : "transparent",
              color: i === 0 ? "#A07BFF" : "#3A3A50",
              border: i === 0 ? "1px solid rgba(91,33,232,0.3)" : "1px solid transparent",
            }}
          >
            {d}
          </span>
        ))}
      </div>

      {/* Agent output */}
      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm" style={{ background: "rgba(91,33,232,0.2)" }}>
            📣
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>Content Creator</p>
            <p className="text-xs" style={{ color: "#5A5A70" }}>Marketing · STAFFD specialist</p>
          </div>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "#22C55E", border: "1px solid rgba(34,197,94,0.2)" }}>
            Done
          </span>
        </div>

        <div className="space-y-2 agent-output" style={{ fontSize: "12px", lineHeight: "1.7" }}>
          <p style={{ color: "#F0F0F8", fontWeight: 600, marginBottom: "8px" }}>Q3 Campaign Brief — SaaS Founders</p>
          <p style={{ color: "#9090A8" }}>
            Your audience is early-stage SaaS founders who are doing everything themselves. They&apos;re not looking for inspiration — they need output they can use today.
          </p>
          <p style={{ color: "#9090A8" }}>
            <strong style={{ color: "#D0D0E8" }}>Core message:</strong> You built the product. Let your staff run the business. Lead with the time angle — not AI, not automation. Staff.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {["Campaign brief", "5 ad headlines", "Email sequence"].map((tag) => (
              <span key={tag} className="text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(91,33,232,0.1)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.2)" }}>
                {tag} ✓
              </span>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex items-center gap-2 mt-4 pt-3" style={{ borderTop: "1px solid #1A1A24" }}>
          <div
            className="flex-1 h-8 rounded-lg px-3 flex items-center"
            style={{ background: "#111118", border: "1px solid #2A2A38" }}
          >
            <span className="text-xs" style={{ color: "#3A3A50" }}>Write a social post from this brief...</span>
          </div>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center btn-primary">
            <span style={{ fontSize: "12px" }}>↑</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      {/* Page grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Top glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: "-100px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "900px",
          height: "600px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.12) 0%, transparent 65%)",
        }}
      />

      <Nav />

      <div className="relative z-10">

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="pt-36 pb-20 px-6 text-center">
          <div className="max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8 text-xs font-semibold"
              style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5B21E8", display: "inline-block" }} />
              AI-powered business staff
            </div>

            {/* H1 */}
            <h1
              className="font-bold leading-tight mb-6"
              style={{ fontSize: "clamp(38px, 6vw, 72px)", color: "#F0F0F8", letterSpacing: "-0.025em", lineHeight: 1.05 }}
            >
              Your business needs<br />
              <span style={{ color: "#5B21E8", textShadow: "0 0 60px rgba(91,33,232,0.4)" }}>
                a full team.
              </span>{" "}
              Now it has one.
            </h1>

            {/* Subhead */}
            <p
              className="mb-10 max-w-2xl mx-auto"
              style={{ fontSize: "clamp(16px, 2vw, 20px)", color: "#9090A8", lineHeight: 1.65 }}
            >
              83 specialists across 10 departments — Marketing, Sales, Legal, HR, Finance,
              Operations, Paid Media, Design, Reputation, and The CEO. On call the moment you sign up.
              No hiring. No payroll. No overhead.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <Link
                href="/auth/signup"
                className="btn-primary px-8 py-3.5 rounded-xl font-semibold text-white"
                style={{ fontSize: "15px", textDecoration: "none" }}
              >
                Get STAFFD — free to start →
              </Link>
              <Link
                href="/pricing"
                className="px-8 py-3.5 rounded-xl font-semibold text-sm"
                style={{
                  background: "transparent",
                  border: "1px solid #2A2A38",
                  color: "#9090A8",
                  textDecoration: "none",
                  transition: "border-color 0.15s, color 0.15s",
                }}
              >
                See pricing
              </Link>
            </div>

            {/* Trust strip */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {[
                "Powered by Claude AI",
                "Your data never trains AI",
                "7-day money-back guarantee",
                "Cancel any time",
              ].map((t) => (
                <span key={t} className="flex items-center gap-1.5 text-xs" style={{ color: "#3A3A55" }}>
                  <span style={{ color: "#5B21E8" }}>✓</span> {t}
                </span>
              ))}
            </div>
          </div>

          {/* Product mock */}
          <div className="mt-16 max-w-2xl mx-auto">
            <ProductMock />
          </div>
        </section>

        {/* ── HOW IT WORKS ──────────────────────────────────────────────────── */}
        <section className="py-24 px-6" style={{ borderTop: "1px solid #111118" }}>
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>How it works</p>
              <h2 className="font-bold" style={{ color: "#F0F0F8", fontSize: "clamp(28px, 4vw, 42px)", letterSpacing: "-0.02em" }}>
                Staff your business in minutes.
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {HOW_IT_WORKS.map((step) => (
                <div key={step.step} className="relative p-6 rounded-2xl" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <div
                    className="text-4xl font-black mb-5 leading-none"
                    style={{ color: "rgba(91,33,232,0.15)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {step.step}
                  </div>
                  <h3 className="font-semibold mb-2" style={{ color: "#F0F0F8", fontSize: "15px" }}>{step.title}</h3>
                  <p className="text-sm" style={{ color: "#7070A0", lineHeight: 1.65 }}>{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DEPARTMENTS ───────────────────────────────────────────────────── */}
        <section className="py-24 px-6" style={{ borderTop: "1px solid #111118" }}>
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>Your staff</p>
              <h2 className="font-bold mb-4" style={{ color: "#F0F0F8", fontSize: "clamp(28px, 4vw, 42px)", letterSpacing: "-0.02em" }}>
                83 specialists. 10 departments.
              </h2>
              <p className="text-base max-w-xl mx-auto" style={{ color: "#7070A0", lineHeight: 1.6 }}>
                Walk into any department, describe what you need — the right specialist is automatically assigned. You never have to choose between agents.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {DEPARTMENTS.map((dept) => (
                <div
                  key={dept.name}
                  className="p-5 rounded-2xl group"
                  style={{
                    background: "#111118",
                    border: "1px solid #2A2A38",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                >
                  <div className="text-2xl mb-3">{dept.icon}</div>
                  <p className="font-semibold mb-0.5" style={{ color: "#F0F0F8", fontSize: "14px" }}>{dept.name}</p>
                  <p className="text-xs mb-3" style={{ color: "#5A5A70" }}>{dept.count} specialists</p>
                  <p className="text-xs" style={{ color: "#4A4A65", lineHeight: 1.5 }}>{dept.example}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES ──────────────────────────────────────────────────────── */}
        <section className="py-24 px-6" style={{ borderTop: "1px solid #111118" }}>
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>What makes STAFFD different</p>
              <h2 className="font-bold" style={{ color: "#F0F0F8", fontSize: "clamp(28px, 4vw, 42px)", letterSpacing: "-0.02em" }}>
                Built for the way business actually works.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="p-6 rounded-2xl"
                  style={{ background: "#111118", border: "1px solid #2A2A38" }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-4"
                    style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.2)" }}
                  >
                    {f.icon}
                  </div>
                  <h3 className="font-semibold mb-2" style={{ color: "#F0F0F8", fontSize: "16px" }}>{f.title}</h3>
                  <p className="text-sm" style={{ color: "#7070A0", lineHeight: 1.7 }}>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRICING CALLOUT ───────────────────────────────────────────────── */}
        <section className="py-24 px-6" style={{ borderTop: "1px solid #111118" }}>
          <div className="max-w-4xl mx-auto">
            <div
              className="rounded-2xl p-10 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(91,33,232,0.1) 0%, rgba(91,33,232,0.03) 100%)",
                border: "1px solid rgba(91,33,232,0.25)",
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>Pricing</p>
              <h2 className="font-bold mb-4" style={{ color: "#F0F0F8", fontSize: "clamp(24px, 4vw, 36px)", letterSpacing: "-0.02em" }}>
                Less than one freelancer.<br />An entire business team.
              </h2>
              <p className="text-sm mb-8 max-w-xl mx-auto" style={{ color: "#9090A8", lineHeight: 1.65 }}>
                Plans start at <strong style={{ color: "#F0F0F8" }}>$39/month</strong> and include unlimited written work — copy, contracts, proposals, plans.
                Images, videos, and specialty departments are included at every tier.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/pricing"
                  className="btn-primary px-7 py-3 rounded-xl text-sm font-semibold text-white"
                  style={{ textDecoration: "none" }}
                >
                  See all plans →
                </Link>
                <Link
                  href="/auth/signup"
                  className="text-sm"
                  style={{ color: "#7070A0", textDecoration: "none" }}
                >
                  Start with 3 free trial runs per department
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── TRUST ─────────────────────────────────────────────────────────── */}
        <section className="py-24 px-6" style={{ borderTop: "1px solid #111118" }}>
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5B21E8" }}>Our promise</p>
              <h2 className="font-bold" style={{ color: "#F0F0F8", fontSize: "clamp(28px, 4vw, 42px)", letterSpacing: "-0.02em" }}>
                Built on trust. Not hype.
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {TRUST_ITEMS.map((t) => (
                <div key={t.title} className="p-5 rounded-2xl" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  <div className="text-2xl mb-3">{t.icon}</div>
                  <p className="font-semibold text-sm mb-2" style={{ color: "#F0F0F8" }}>{t.title}</p>
                  <p className="text-xs" style={{ color: "#7070A0", lineHeight: 1.65 }}>{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ─────────────────────────────────────────────────────── */}
        <section className="py-24 px-6" style={{ borderTop: "1px solid #111118" }}>
          <div className="max-w-3xl mx-auto text-center">
            {/* Glow */}
            <div
              className="pointer-events-none"
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                width: "600px",
                height: "300px",
                borderRadius: "50%",
                background: "radial-gradient(ellipse, rgba(91,33,232,0.15) 0%, transparent 70%)",
              }}
            />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#5B21E8" }}>Ready when you are</p>
              <h2
                className="font-bold mb-5"
                style={{ color: "#F0F0F8", fontSize: "clamp(32px, 5vw, 56px)", letterSpacing: "-0.025em", lineHeight: 1.05 }}
              >
                Your staff is waiting.
              </h2>
              <p className="text-base mb-10 max-w-xl mx-auto" style={{ color: "#9090A8", lineHeight: 1.65 }}>
                Sign up in two minutes, answer a few questions about your business, and your starter staff will be on duty before you finish your coffee.
              </p>
              <Link
                href="/auth/signup"
                className="btn-primary inline-block px-10 py-4 rounded-xl font-semibold text-white"
                style={{ fontSize: "16px", textDecoration: "none" }}
              >
                Hire your staff →
              </Link>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6">
                {["No credit card required to explore", "7-day money-back", "Cancel any time"].map((t) => (
                  <span key={t} className="text-xs" style={{ color: "#3A3A55" }}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── FOOTER ────────────────────────────────────────────────────────── */}
        <footer
          className="px-6 py-8"
          style={{ borderTop: "1px solid #111118" }}
        >
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Image src="/logo-light.png" alt="STAFFD" width={72} height={32} style={{ objectFit: "contain", opacity: 0.5 }} />
              <span className="text-xs" style={{ color: "#2A2A38" }}>© {new Date().getFullYear()} STAFFD · Operated by Cybrid Agency</span>
            </div>
            <div className="flex items-center gap-6 text-xs" style={{ color: "#3A3A50" }}>
              <Link href="/pricing" style={{ color: "#3A3A50", textDecoration: "none" }}>Pricing</Link>
              <Link href="/privacy" style={{ color: "#3A3A50", textDecoration: "none" }}>Privacy</Link>
              <Link href="/terms" style={{ color: "#3A3A50", textDecoration: "none" }}>Terms</Link>
              <a href="mailto:hello@urstaffd.com" style={{ color: "#3A3A50", textDecoration: "none" }}>Contact</a>
            </div>
          </div>
        </footer>

      </div>
    </main>
  );
}
