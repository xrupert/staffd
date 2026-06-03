"use client";

/**
 * /dashboard/admin/* shared layout (Decision 74 — simplified).
 *
 * Client-side super-admin gate using PB auth-refresh + ADMIN_EMAIL match
 * (mirrors the pattern in /dashboard/admin/security/page.tsx which now
 * delegates auth to this layout).
 *
 * Logs every page navigation to super_admin_audit_log via the server-side
 * /api/admin/log-page-view endpoint (no admin token exposed to browser).
 *
 * On non-super-admin: redirects to /dashboard with a brief 403 message.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import pb from "../../../lib/pb";

const PUBLIC_PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";
const ADMIN_EMAIL_PUBLIC = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();

type GateState = "checking" | "authorized" | "denied" | "no_session";

async function checkSuperAdmin(): Promise<GateState> {
  if (!pb.authStore.isValid) return "no_session";
  const user = pb.authStore.model as { email?: string } | null;
  const email = user?.email?.trim().toLowerCase();
  if (!email) return "denied";

  // If the client has the admin email baked in (NEXT_PUBLIC_ADMIN_EMAIL),
  // we can short-circuit. Otherwise we still consult the server to be safe.
  if (ADMIN_EMAIL_PUBLIC && email === ADMIN_EMAIL_PUBLIC) return "authorized";

  // Server-side verification: ping a known super-admin-gated endpoint.
  // If it returns 200/204, the user is authorized.
  try {
    const token = pb.authStore.token;
    const res = await fetch(`/api/admin/log-page-view?pbToken=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "/dashboard/admin/(gate-check)" }),
    });
    return res.ok ? "authorized" : "denied";
  } catch {
    return "denied";
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gate, setGate] = useState<GateState>("checking");

  useEffect(() => {
    void (async () => {
      const state = await checkSuperAdmin();
      setGate(state);
      if (state === "no_session") {
        window.location.href = "/auth/login";
      } else if (state === "authorized" && pathname) {
        // Log the page view (non-blocking)
        try {
          const token = pb.authStore.token;
          void fetch(`/api/admin/log-page-view?pbToken=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resource: pathname }),
          });
        } catch {
          /* non-blocking */
        }
      }
    })();
  }, [pathname]);

  if (gate === "checking") {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "#09090F", color: "#7070A0" }}>
        <p className="text-sm">Checking super-admin access…</p>
      </main>
    );
  }

  if (gate === "denied" || gate === "no_session") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6" style={{ background: "#09090F", color: "#D0D0E8" }}>
        <p className="text-base font-semibold" style={{ color: "#EF4444" }}>403 — super-admin only</p>
        <p className="text-sm" style={{ color: "#7070A0" }}>
          This area is restricted to the configured ADMIN_EMAIL account.
        </p>
        <a href="/dashboard" className="text-sm" style={{ color: "#A07BFF" }}>← Back to dashboard</a>
      </main>
    );
  }

  // Authorized — render shared admin chrome + children
  return (
    <div className="min-h-screen" style={{ background: "#09090F" }}>
      <nav
        className="border-b sticky top-0 z-20 backdrop-blur"
        style={{
          background: "rgba(13,13,20,0.85)",
          borderColor: "#2A2A38",
        }}
      >
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/dashboard">
              <Image src="/logo-light.png" alt="STAFFD" width={70} height={30} style={{ objectFit: "contain" }} />
            </a>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5B21E8" }}>
              Operator
            </span>
            <span className="text-xs" style={{ color: "#5A5A70" }}>›</span>
            <a href="/dashboard/admin" className="text-xs font-medium" style={{ color: "#D0D0E8" }}>
              Admin
            </a>
            {pathname && pathname !== "/dashboard/admin" && (
              <>
                <span className="text-xs" style={{ color: "#5A5A70" }}>›</span>
                <span className="text-xs" style={{ color: "#7070A0" }}>
                  {pathname.replace("/dashboard/admin/", "")}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <a href="/dashboard/admin/security" style={{ color: pathname === "/dashboard/admin/security" ? "#A07BFF" : "#7070A0" }}>
              Security
            </a>
            <a href="/dashboard/admin/vault-metrics" style={{ color: pathname === "/dashboard/admin/vault-metrics" ? "#A07BFF" : "#7070A0" }}>
              Vault Metrics
            </a>
            <a href="/dashboard" style={{ color: "#5A5A70" }}>← Back</a>
          </div>
        </div>
      </nav>
      {children}
      <footer className="max-w-5xl mx-auto px-6 py-6 text-xs" style={{ color: "#3A3A55" }}>
        Decision 74 — super-admin overlay. All actions logged to{" "}
        <code style={{ color: "#7070A0" }}>super_admin_audit_log</code>.
        {PUBLIC_PB_URL && (
          <>
            {" "}
            View logs in PB admin: <code style={{ color: "#7070A0" }}>{PUBLIC_PB_URL.replace(/\/$/, "")}/_/</code>
          </>
        )}
      </footer>
    </div>
  );
}
