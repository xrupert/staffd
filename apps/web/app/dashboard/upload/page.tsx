"use client";

/**
 * /dashboard/upload — placeholder (W91-rollback / Model B3).
 *
 * Cold-start data lands in STAFFD via upload paths (CSV contacts, document
 * archives, support history) — those paths are W95 work. Until then this is
 * a stub that points the owner at their staff. No vendor names, no
 * "connect your account" — STAFFD voice.
 */

import Image from "next/image";

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "32px",
};

export default function UploadPage() {
  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Front Desk</a>
        </header>

        <div style={{ ...cardStyle, textAlign: "center" }}>
          <p className="text-3xl mb-3">📥</p>
          <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "1.4rem" }}>Bulk upload is coming soon</h1>
          <p className="text-sm mb-6" style={{ color: "#9090A8", lineHeight: 1.6 }}>
            Soon you&apos;ll be able to bring your contacts, documents, and history into STAFFD in one move. In the meantime, just tell your staff what you need — they&apos;ll take it from there.
          </p>
          <a
            href="/dashboard?ask=I%20want%20to%20add%20some%20contacts%20and%20get%20my%20business%20set%20up"
            className="text-sm px-4 py-2 rounded-xl inline-block btn-primary text-white font-semibold"
            style={{ textDecoration: "none" }}
          >
            Ask your specialist →
          </a>
        </div>
      </div>
    </main>
  );
}
