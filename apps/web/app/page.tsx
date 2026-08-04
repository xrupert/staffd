import Image from "next/image";
import Link from "next/link";

const OUTCOMES = [
  {
    icon: "🎬",
    title: "Create a campaign that gets attention",
    body: "Strategy, scripts, visuals, email, social posts, publishing plan, and performance review—coordinated as one mission.",
  },
  {
    icon: "🤝",
    title: "Turn interest into customers",
    body: "Organize leads, prepare follow-ups, draft proposals, and keep every next step moving without living in a CRM.",
  },
  {
    icon: "💬",
    title: "Take care of every customer",
    body: "Triage incoming questions, prepare accurate replies, escalate sensitive issues, and keep the owner in control.",
  },
  {
    icon: "⚖️",
    title: "Handle important business work",
    body: "Prepare agreements, policies, hiring materials, financial analysis, operating plans, and decision-ready summaries.",
  },
  {
    icon: "📈",
    title: "Know what needs attention",
    body: "STAFFD watches business activity, finds risks and opportunities, and recommends the next useful action in plain language.",
  },
  {
    icon: "🧠",
    title: "Build a business that remembers",
    body: "Every approved decision, artifact, result, and lesson becomes useful context for the next mission.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Tell STAFFD what you need",
    body: "Use normal language. Ask for an outcome—not a prompt, agent, workflow, or integration.",
  },
  {
    step: "02",
    title: "Your staff plans the work",
    body: "The Chief Orchestrator assembles the right specialists, tools, budget, approvals, and success criteria.",
  },
  {
    step: "03",
    title: "Review finished work",
    body: "STAFFD executes, checks, repairs, and presents the result with evidence. Nothing important goes out without your approval.",
  },
];

const TRUST = [
  "Your data never trains AI",
  "Approval before outbound work",
  "Evidence for completed missions",
  "Cancel any time",
];

function Nav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#09090F]/85 px-6 py-4 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" aria-label="STAFFD home">
          <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} className="object-contain" priority />
        </Link>
        <div className="flex items-center gap-5 text-xs">
          <Link href="/pricing" className="text-[#9090A8] transition hover:text-white">Pricing</Link>
          <Link href="/auth/login" className="text-[#9090A8] transition hover:text-white">Sign in</Link>
          <Link href="/auth/signup" className="btn-primary rounded-lg px-4 py-2 font-semibold text-white">
            Get staffed →
          </Link>
        </div>
      </div>
    </nav>
  );
}

function ExecutivePreview() {
  const items = [
    ["2 approvals waiting", "Review"],
    ["Warm leads need follow-up", "Prepare"],
    ["Campaign performance changed", "Investigate"],
    ["Support issue needs attention", "Resolve"],
  ];

  return (
    <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-[#2A2A38] bg-[#0D0D15] text-left shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-2 border-b border-[#1A1A24] px-5 py-4">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-3 text-xs text-[#57576E]">STAFFD · Executive Assistant</span>
      </div>
      <div className="grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8B68F2]">Good morning</p>
          <h2 className="mt-3 text-2xl font-semibold text-[#F0F0F8]">What would you like your staff to accomplish?</h2>
          <div className="mt-5 rounded-xl border border-[#343448] bg-[#12121B] p-4">
            <p className="text-sm leading-6 text-[#B6B6C8]">I need a viral-ready launch campaign for our new product. Keep it on brand and show me everything before it goes out.</p>
            <div className="mt-4 flex items-center justify-between border-t border-[#252534] pt-3 text-xs">
              <span className="text-[#66667E]">Chief Orchestrator will plan the mission</span>
              <span className="rounded-lg bg-[#5B21E8] px-3 py-1.5 font-semibold text-white">Brief my staff ↑</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#77778E]">
            {["Launch a product", "Follow up with leads", "Review my business", "Handle a legal question"].map((item) => (
              <span key={item} className="rounded-full border border-[#292938] px-3 py-1.5">{item}</span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[#242432] bg-[#101018] p-4">
          <p className="text-xs font-semibold text-[#D8D8E5]">Needs your attention</p>
          <div className="mt-3 space-y-2">
            {items.map(([label, action]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-[#242432] bg-[#14141D] px-3 py-2.5">
                <span className="pr-3 text-xs text-[#9696AA]">{label}</span>
                <span className="text-xs font-semibold text-[#A98CFF]">{action}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-[#5F5F76]">Your tools stay behind the scenes. You see decisions, progress, evidence, and completed work.</p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#09090F] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(91,33,232,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(91,33,232,0.035)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="pointer-events-none fixed left-1/2 top-[-180px] h-[650px] w-[950px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(91,33,232,0.16)_0%,transparent_68%)]" />
      <Nav />

      <div className="relative z-10">
        <section className="px-6 pb-24 pt-36 text-center">
          <div className="mx-auto max-w-5xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#5B21E8]/30 bg-[#5B21E8]/10 px-3 py-1.5 text-xs font-semibold text-[#B19AFF]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#7C4DFF]" />
              The AI staff that gets business work done
            </div>
            <h1 className="mx-auto mt-8 max-w-4xl text-[clamp(42px,7vw,78px)] font-bold leading-[1.02] tracking-[-0.035em] text-[#F3F3FA]">
              Tell STAFFD the outcome. <span className="text-[#7444F5]">Your staff handles the work.</span>
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-[clamp(17px,2vw,21px)] leading-8 text-[#9A9AAF]">
              No prompts to engineer. No agents to choose. No software maze to manage. Brief your business in plain language and get coordinated, reviewed, ready-to-use work.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/auth/signup" className="btn-primary rounded-xl px-8 py-3.5 text-sm font-semibold text-white">Start with your first mission →</Link>
              <Link href="/pricing" className="rounded-xl border border-[#303043] px-8 py-3.5 text-sm font-semibold text-[#A5A5B8] transition hover:border-[#5B21E8] hover:text-white">See pricing</Link>
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {TRUST.map((item) => <span key={item} className="text-xs text-[#57576D]"><span className="text-[#7444F5]">✓</span> {item}</span>)}
            </div>
          </div>
          <div className="mt-16"><ExecutivePreview /></div>
        </section>

        <section className="border-t border-white/5 px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7444F5]">Ask for outcomes</p>
              <h2 className="mt-4 text-[clamp(30px,4vw,46px)] font-bold tracking-[-0.025em] text-[#F0F0F8]">Business help that feels like staff—not software.</h2>
              <p className="mt-4 leading-7 text-[#85859B]">STAFFD coordinates specialists, memory, approvals, analytics, customer systems, communication, documents, and publishing behind one simple request.</p>
            </div>
            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {OUTCOMES.map((outcome) => (
                <div key={outcome.title} className="rounded-2xl border border-[#292938] bg-[#111118] p-6">
                  <div className="text-2xl">{outcome.icon}</div>
                  <h3 className="mt-4 font-semibold text-[#F0F0F8]">{outcome.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#77778E]">{outcome.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-white/5 px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7444F5]">How it works</p>
              <h2 className="mt-4 text-[clamp(30px,4vw,44px)] font-bold tracking-[-0.025em] text-[#F0F0F8]">One briefing. A coordinated company behind it.</h2>
            </div>
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {HOW_IT_WORKS.map((item) => (
                <div key={item.step} className="rounded-2xl border border-[#292938] bg-[#111118] p-6">
                  <div className="text-4xl font-black text-[#5B21E8]/25">{item.step}</div>
                  <h3 className="mt-5 font-semibold text-[#F0F0F8]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#77778E]">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-white/5 px-6 py-24">
          <div className="mx-auto max-w-4xl rounded-3xl border border-[#5B21E8]/25 bg-[linear-gradient(135deg,rgba(91,33,232,0.13),rgba(91,33,232,0.03))] p-10 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8F6DF5]">Simple, honest pricing</p>
            <h2 className="mt-4 text-[clamp(28px,4vw,40px)] font-bold tracking-[-0.025em] text-[#F3F3FA]">An entire business staff from $39/month.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#9999AD]">Written work is included by plan. Higher-cost production—such as advanced video or specialty processing—is governed by clear credits and mission budgets before work begins. Industry expansion packs strengthen the same staff experience; they are not separate apps.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href="/pricing" className="btn-primary rounded-xl px-7 py-3 text-sm font-semibold text-white">See plans →</Link>
              <Link href="/auth/signup" className="text-sm font-semibold text-[#B6A0F5]">Start free without a credit card</Link>
            </div>
          </div>
        </section>

        <section className="border-t border-white/5 px-6 py-24 text-center">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7444F5]">Ready when you are</p>
            <h2 className="mt-4 text-[clamp(36px,6vw,62px)] font-bold tracking-[-0.035em] text-[#F3F3FA]">What should your staff accomplish first?</h2>
            <p className="mx-auto mt-5 max-w-xl leading-7 text-[#8F8FA4]">Describe the business result. STAFFD will plan the work, assemble the right team, use the right tools, and keep you in control.</p>
            <Link href="/auth/signup" className="btn-primary mt-9 inline-block rounded-xl px-10 py-4 font-semibold text-white">Brief your staff →</Link>
          </div>
        </section>

        <footer className="border-t border-white/5 px-6 py-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-5">
              <Image src="/logo-light.png" alt="STAFFD" width={72} height={32} className="object-contain opacity-50" />
              <span className="text-xs text-[#353546]">© 2026 STAFFD · Operated by Cybrid Agency</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-[#4A4A5D]">
              <Link href="/pricing">Pricing</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a href="mailto:hello@urstaffd.com">Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
