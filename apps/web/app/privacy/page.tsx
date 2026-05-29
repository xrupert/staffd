import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — STAFFD",
  description: "How STAFFD collects, uses, and protects your business data.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      <div className="relative z-10 max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <Link href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
          </Link>
          <div className="flex gap-6 text-xs" style={{ color: "#5A5A70" }}>
            <Link href="/privacy" style={{ color: "#A07BFF", textDecoration: "none" }}>Privacy</Link>
            <Link href="/terms" style={{ color: "#5A5A70", textDecoration: "none" }}>Terms</Link>
            <Link href="/" style={{ color: "#5A5A70", textDecoration: "none" }}>← Home</Link>
          </div>
        </header>

        <div className="prose-staffd" style={{ color: "#D0D0E8", fontSize: "14px", lineHeight: 1.7 }}>
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "#5B21E8", fontWeight: 700, letterSpacing: "0.12em" }}>
            Privacy Policy
          </p>
          <h1 className="text-3xl font-bold mb-3" style={{ color: "#F0F0F8", letterSpacing: "-0.02em" }}>
            Your data, protected.
          </h1>
          <p className="text-sm mb-8" style={{ color: "#5A5A70" }}>
            Last updated: November 1, 2025 · STAFFD, operated by Cybrid Agency.
          </p>

          <Section title="The short version">
            <p>
              STAFFD only uses your business information to make your staff produce better
              output for you. We do not sell your data, we do not train AI models on it, and
              you can delete everything at any time.
            </p>
          </Section>

          <Section title="What we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li><strong style={{ color: "#F0F0F8" }}>Account information</strong> — your name, email, and password (hashed) when you sign up.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Business Vault data</strong> — anything you enter into your Business Vault (business name, industry, target audience, contact info, etc.).</li>
              <li><strong style={{ color: "#F0F0F8" }}>Work product</strong> — documents, drafts, and reports your staff produces for you.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Subscription data</strong> — your plan, billing status, and Stripe customer ID (we never store your card details).</li>
              <li><strong style={{ color: "#F0F0F8" }}>Anonymous usage analytics</strong> — collected via Plausible Analytics, which does not use cookies or track individuals.</li>
            </ul>
          </Section>

          <Section title="How we use it">
            <ul className="list-disc pl-5 space-y-2">
              <li>To personalize the work your staff produces for your business.</li>
              <li>To remember context across sessions so your team gets better over time.</li>
              <li>To deliver, maintain, and improve the STAFFD platform.</li>
              <li>To process subscription payments via Stripe.</li>
              <li>To communicate with you about your account or service updates.</li>
            </ul>
          </Section>

          <Section title="AI disclosure">
            <p>
              STAFFD uses Anthropic&apos;s Claude API to generate content for you. When you ask
              an agent to produce work, your task and relevant Vault context are sent to
              Anthropic for processing. Anthropic operates under their own privacy policy and
              <strong style={{ color: "#F0F0F8" }}> does not train their AI models on data sent through the API.</strong>
            </p>
            <p className="mt-3">
              We do not use your business data, generated content, or any interactions with
              STAFFD to train any AI model — ours, Anthropic&apos;s, or anyone else&apos;s.
            </p>
          </Section>

          <Section title="Who we share data with">
            <p>STAFFD shares the minimum data necessary with these service providers:</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li><strong style={{ color: "#F0F0F8" }}>Anthropic</strong> — to produce the work your staff delivers (your task + Vault context).</li>
              <li><strong style={{ color: "#F0F0F8" }}>Stripe</strong> — to process subscription payments. Stripe handles all card data directly.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Vercel</strong> — to host the STAFFD application.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Railway</strong> — to host backend services (database, integrations).</li>
            </ul>
            <p className="mt-3">
              We never sell your data. We never share it with advertisers. We never use it
              for marketing other products.
            </p>
          </Section>

          <Section title="Your rights (GDPR / CCPA)">
            <p>You can, at any time:</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li><strong style={{ color: "#F0F0F8" }}>Access your data</strong> — see everything we store about you in your account dashboard.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Export your data</strong> — request a complete data export via email.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Correct your data</strong> — edit anything in your Vault directly.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Delete your data</strong> — request full account deletion. We will permanently delete all of your data within 30 days.</li>
              <li><strong style={{ color: "#F0F0F8" }}>Opt out</strong> — California residents can opt out of any sale of personal information (we do not sell any data, so this is automatic).</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, email{" "}
              <a href="mailto:privacy@urstaffd.com" style={{ color: "#A07BFF" }}>privacy@urstaffd.com</a>.
            </p>
          </Section>

          <Section title="Security">
            <p>
              All data is encrypted in transit (TLS) and at rest. Access to production systems
              is restricted and logged. Passwords are hashed using industry-standard algorithms.
              We follow the principle of least privilege for all internal access.
            </p>
          </Section>

          <Section title="Cookies & tracking">
            <p>
              STAFFD does not use third-party tracking cookies. We use a single first-party
              session cookie to keep you signed in. Our analytics provider (Plausible) is
              cookie-free and does not track individual users.
            </p>
          </Section>

          <Section title="Children">
            <p>
              STAFFD is built for businesses and is not directed at children under 16.
              We do not knowingly collect personal information from anyone under 16.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              If we change this policy in a material way, we will notify you by email and
              post a notice in the dashboard at least 30 days before the change takes effect.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions, requests, or concerns? Email{" "}
              <a href="mailto:privacy@urstaffd.com" style={{ color: "#A07BFF" }}>privacy@urstaffd.com</a>.
            </p>
          </Section>
        </div>

        <footer className="mt-16 pt-8 text-center text-xs" style={{ borderTop: "1px solid #1E1E2A", color: "#3A3A50" }}>
          <p>© {new Date().getFullYear()} STAFFD · Operated by Cybrid Agency</p>
        </footer>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold mb-3" style={{ color: "#F0F0F8", letterSpacing: "-0.01em" }}>
        {title}
      </h2>
      <div className="text-sm" style={{ color: "#9090A8" }}>
        {children}
      </div>
    </section>
  );
}
