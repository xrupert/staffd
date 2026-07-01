import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service — STAFFD",
  description: "The terms that govern your use of STAFFD.",
};

export default function TermsPage() {
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
        <header className="flex items-center justify-between mb-12">
          <Link href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
          </Link>
          <div className="flex gap-6 text-xs" style={{ color: "#5A5A70" }}>
            <Link href="/privacy" style={{ color: "#5A5A70", textDecoration: "none" }}>Privacy</Link>
            <Link href="/terms" style={{ color: "#A07BFF", textDecoration: "none" }}>Terms</Link>
            <Link href="/" style={{ color: "#5A5A70", textDecoration: "none" }}>← Home</Link>
          </div>
        </header>

        <div className="prose-staffd" style={{ color: "#D0D0E8", fontSize: "14px", lineHeight: 1.7 }}>
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "#5B21E8", fontWeight: 700, letterSpacing: "0.12em" }}>
            Terms of Service
          </p>
          <h1 className="text-3xl font-bold mb-3" style={{ color: "#F0F0F8", letterSpacing: "-0.02em" }}>
            The rules of the road.
          </h1>
          <p className="text-sm mb-8" style={{ color: "#5A5A70" }}>
            Last updated: November 1, 2025 · STAFFD, operated by Cybrid Agency.
          </p>

          <Section title="1. Agreement">
            <p>
              By creating an account or using STAFFD, you agree to these Terms and to our{" "}
              <Link href="/privacy" style={{ color: "#A07BFF" }}>Privacy Policy</Link>. If you do
              not agree, do not use the service.
            </p>
          </Section>

          <Section title="2. What STAFFD is">
            <p>
              STAFFD is a software-as-a-service platform that gives small businesses access to a
              staff of specialists organized into departments (Marketing, Sales, Legal, HR, Finance,
              Operations, Paid Media, Design, Reputation, and a cross-department CEO function).
              Agents produce content, documents, and recommendations based on your Business Vault
              inputs and the tasks you give them.
            </p>
          </Section>

          <Section title="3. Your account">
            <p>
              You are responsible for keeping your login credentials secure. You must be at
              least 18 years old to use STAFFD. You agree to provide accurate information and
              keep it current.
            </p>
          </Section>

          <Section title="4. AI output disclaimer">
            <p>
              STAFFD agents produce AI-generated output. This output is a starting point, not
              a finished deliverable. You are responsible for reviewing, editing, and verifying
              any output before using it in your business.
            </p>
            <p className="mt-3">
              <strong style={{ color: "#F0F0F8" }}>Legal documents</strong> drafted by The Counsel agent are starting drafts and
              are not legal advice. You must have a licensed attorney review any legal
              document before relying on it.
            </p>
            <p className="mt-3">
              <strong style={{ color: "#F0F0F8" }}>Financial documents</strong> drafted by The CFO agent are templates and are not
              financial, tax, or investment advice. Consult a licensed professional before
              acting on them.
            </p>
            <p className="mt-3">
              <strong style={{ color: "#F0F0F8" }}>Strategic recommendations</strong> from The CEO are advisory only and do not
              guarantee any specific business outcome.
            </p>
          </Section>

          <Section title="5. Acceptable use">
            <p>You agree NOT to use STAFFD to:</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>Generate content that is illegal, defamatory, harassing, or infringes intellectual property.</li>
              <li>Impersonate another person or business.</li>
              <li>Send unsolicited bulk email (spam) or violate any anti-spam laws (CAN-SPAM, CASL, GDPR).</li>
              <li>Attempt to reverse-engineer, scrape, or abuse the platform.</li>
              <li>Resell or sublicense STAFFD access outside of an active Agency plan.</li>
              <li>Generate content depicting violence, abuse, or illegal activity.</li>
            </ul>
            <p className="mt-3">
              We may suspend or terminate accounts that violate these rules.
            </p>
          </Section>

          <Section title="6. Subscriptions and billing">
            <ul className="list-disc pl-5 space-y-2">
              <li>Subscriptions are billed monthly or annually via our payment processor.</li>
              <li>Plans renew automatically at the end of each billing period until cancelled.</li>
              <li>You can cancel any time via your account dashboard — cancellation takes effect at the end of the current period.</li>
              <li>Annual subscriptions are non-refundable except during the 7-day money-back guarantee window.</li>
              <li>We offer a 7-day money-back guarantee on first-time subscriptions. Email <a href="mailto:billing@urstaffd.com" style={{ color: "#A07BFF" }}>billing@urstaffd.com</a> within 7 days of signing up.</li>
              <li>Price changes will be communicated at least 30 days in advance.</li>
            </ul>
          </Section>

          <Section title="7. Ownership">
            <p>
              <strong style={{ color: "#F0F0F8" }}>Your content stays yours.</strong> You retain all rights to the
              documents, copy, and other output that STAFFD agents produce on your behalf.
              You may use it for any commercial or personal purpose.
            </p>
            <p className="mt-3">
              STAFFD retains ownership of the platform itself, including all code, design, agent
              prompts, integrations, and underlying technology.
            </p>
          </Section>

          <Section title="8. Data deletion">
            <p>
              You can request full deletion of your data at any time via the account settings
              or by emailing <a href="mailto:privacy@urstaffd.com" style={{ color: "#A07BFF" }}>privacy@urstaffd.com</a>.
              We will permanently delete all of your data within 30 days of the request,
              except for any data we are legally required to retain.
            </p>
          </Section>

          <Section title="9. Service availability">
            <p>
              We aim for high uptime but make no guarantee of uninterrupted service. Planned
              maintenance, third-party outages (Anthropic, our payment processor, Railway, etc.), or other
              circumstances may cause temporary unavailability.
            </p>
          </Section>

          <Section title="10. Limitation of liability">
            <p>
              STAFFD is provided &quot;as is.&quot; To the maximum extent permitted by law, STAFFD,
              Cybrid Agency, and their affiliates are not liable for any indirect, incidental,
              consequential, or punitive damages arising from your use of the service.
            </p>
            <p className="mt-3">
              Our total liability for any claim arising from these Terms is capped at the
              amount you paid us in the 12 months prior to the claim.
            </p>
          </Section>

          <Section title="11. Termination">
            <p>
              You can close your account at any time. We can suspend or terminate your account
              if you breach these Terms. On termination, your access ends immediately and
              your data is deleted per our Privacy Policy.
            </p>
          </Section>

          <Section title="12. Changes to these Terms">
            <p>
              We may update these Terms from time to time. Material changes will be communicated
              by email and posted in the dashboard at least 30 days before taking effect. Continued
              use after the change date means you accept the updated Terms.
            </p>
          </Section>

          <Section title="13. Governing law">
            <p>
              These Terms are governed by the laws of the State of Georgia, United States,
              without regard to conflict-of-law principles. Any disputes will be resolved
              in the state or federal courts located in Georgia.
            </p>
          </Section>

          <Section title="14. Contact">
            <p>
              Questions about these Terms? Email{" "}
              <a href="mailto:hello@urstaffd.com" style={{ color: "#A07BFF" }}>hello@urstaffd.com</a>.
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
