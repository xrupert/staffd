"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import { useEffectivePlan, isSuperAdminClient, type Plan } from "../../lib/hooks/useEffectivePlan";
import { signOut } from "../../lib/auth/signOut";
import CommandCenter from "../components/CommandCenter";
import DepartmentPicker from "../components/DepartmentPicker";
import AddDeptModal from "../components/AddDeptModal";
import CreditsWidget from "../components/CreditsWidget";
import LowCreditsBanner from "../components/LowCreditsBanner";
import TopupModal from "../components/TopupModal";
import MorningBriefCard from "../components/MorningBriefCard";
import InstallPWAModal from "../components/InstallPWAModal";

const DEPARTMENTS = [
  { name: "Marketing", icon: "📣", tagline: "Content, campaigns & social", href: "/dashboard/marketing" },
  { name: "Sales", icon: "🤝", tagline: "Outreach, proposals & closing", href: "/dashboard/sales" },
  { name: "Legal", icon: "⚖️", tagline: "Contracts, policies & compliance", href: "/dashboard/legal" },
  { name: "HR", icon: "👥", tagline: "Hiring, onboarding & performance", href: "/dashboard/hr" },
  { name: "Finance", icon: "💰", tagline: "Invoices, budgets & projections", href: "/dashboard/finance" },
  { name: "Operations", icon: "⚙️", tagline: "SOPs, workflows & systems", href: "/dashboard/operations" },
  { name: "Paid Media", icon: "📈", tagline: "Google, Meta & ad strategy", href: "/dashboard/paid-media" },
  { name: "Design", icon: "🎨", tagline: "Brand, visuals & UI direction", href: "/dashboard/design" },
  { name: "Reputation", icon: "🛡️", tagline: "Support, reviews & community", href: "/dashboard/reputation" },
];

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  agency: "Agency",
};

export default function DashboardPage() {
  const [userName, setUserName] = useState("");
  const [initials, setInitials] = useState("");
  const [vaultPct, setVaultPct] = useState<number | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<"success" | "cancelled" | null>(null);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [showAddDept, setShowAddDept] = useState(false);
  const [unlockedDepts, setUnlockedDepts] = useState<string[]>([]);
  const [addonBanner, setAddonBanner] = useState<{ type: "success" | "cancelled"; dept?: string } | null>(null);
  const [bookingSlug, setBookingSlug] = useState<string | null>(null);
  const [bookingLinkCopied, setBookingLinkCopied] = useState(false);
  const [upcomingBookings, setUpcomingBookings] = useState<Array<{ id: string; attendee_name: string; start_time: string; duration: number }>>([]);
  const [topupOpen, setTopupOpen] = useState(false);

  const effectivePlan = useEffectivePlan(currentPlan as Plan | null);
  const isAdmin = isSuperAdminClient(
    (pb.authStore.record as { email?: string } | null)?.email,
  );

  useEffect(() => {
    if (!pb.authStore.isValid) {
      window.location.href = "/auth/login";
      return;
    }
    const model = pb.authStore.record;
    const name = model?.name ?? "";
    setUserName(name.split(" ")[0] ?? model?.email ?? "");
    const parts = name.trim().split(" ");
    setInitials(
      parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase()
    );
    void loadVaultHealth();
    // Handle Stripe redirect params
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const addon    = params.get("addon");
    const addonDept = params.get("dept") ?? undefined;
    const isSuccess = checkout === "success";
    if (isSuccess || checkout === "cancelled") {
      setCheckoutBanner(checkout as "success" | "cancelled");
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      if (!isSuccess) setTimeout(() => setCheckoutBanner(null), 6000);
    }
    if (addon === "success" || addon === "cancelled") {
      setAddonBanner({ type: addon, dept: addonDept });
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      setTimeout(() => setAddonBanner(null), 6000);
    }
    // After plan checkout success, check if department selection is needed
    void loadPlan(isSuccess);
    void loadBookingSlug();
    void loadUpcomingBookings();
    // Ensure collections exist (no-op if already created)
    void fetch("/api/setup/subscriptions", { method: "POST" }).catch(() => null);
  }, []);

  async function loadPlan(showPickerIfNeeded = false) {
    try {
      const userId = pb.authStore.record?.id ?? "";
      if (!userId) return;
      const res = await fetch(`/api/trial?userId=${userId}`);
      if (res.ok) {
        const data = (await res.json()) as {
          plan: string;
          needs_department_selection?: boolean;
          resolved_departments?: string[];
        };
        setCurrentPlan(data.plan ?? "starter");
        setUnlockedDepts(data.resolved_departments ?? []);
        if (showPickerIfNeeded && data.needs_department_selection) {
          setShowDeptPicker(true);
        }

        // If user signed up via the pricing page, fire Stripe checkout for the
        // plan they picked. This runs once and only when they're still on starter.
        const pendingPlan = localStorage.getItem("staffd_pending_plan");
        const pendingInterval = localStorage.getItem("staffd_pending_interval") ?? "annual";
        if (pendingPlan && pendingPlan !== "starter" && (data.plan ?? "starter") === "starter") {
          localStorage.removeItem("staffd_pending_plan");
          localStorage.removeItem("staffd_pending_interval");
          const userEmail = (pb.authStore.record?.email as string) ?? "";
          try {
            const checkoutRes = await fetch("/api/stripe/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                planId: pendingPlan, interval: pendingInterval, userId, userEmail,
              }),
            });
            const co = (await checkoutRes.json()) as { url?: string };
            if (co.url) window.location.href = co.url;
          } catch { /* user can still pick a plan from the dashboard */ }
        }
      }
    } catch { /* proceed */ }
  }

  async function loadBookingSlug() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      if (!userId) return;
      const res = await pb.collection("businesses").getList(1, 1, { filter: `user = '${userId}'` });
      const rec = res.items[0];
      if (rec && rec.booking_enabled && (rec.booking_slug as string)?.trim()) {
        setBookingSlug(rec.booking_slug as string);
      } else {
        setBookingSlug(null);
      }
    } catch { /* proceed */ }
  }

  async function loadUpcomingBookings() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      if (!userId) return;
      const nowIso = new Date().toISOString();
      const res = await pb.collection("bookings").getList(1, 5, {
        filter: `user = '${userId}' && status != 'cancelled' && start_time >= '${nowIso}'`,
        sort: "start_time",
      });
      setUpcomingBookings(res.items as unknown as typeof upcomingBookings);
    } catch { setUpcomingBookings([]); }
  }

  async function copyBookingLink() {
    if (!bookingSlug) return;
    const url = `${window.location.origin}/book/${bookingSlug}`;
    await navigator.clipboard.writeText(url);
    setBookingLinkCopied(true);
    setTimeout(() => setBookingLinkCopied(false), 2000);
  }

  async function loadVaultHealth() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("businesses").getList(1, 1, { filter: `user = '${userId}'` });
      const rec = res.items[0];
      if (rec) {
        const coreFields = ["business_name", "industry", "description", "target_audience"] as const;
        const filled = coreFields.filter((k) => !!(rec[k] as string)?.trim()).length;
        setVaultPct(Math.round((filled / coreFields.length) * 100));
      } else {
        setVaultPct(0);
      }
    } catch { /* proceed */ }
  }

  const DEPT_LABEL_MAP: Record<string, string> = {
    hr: "HR", finance: "Finance", operations: "Operations",
    "paid-media": "Paid Media", design: "Design", reputation: "Reputation",
  };

  const canAddDept = effectivePlan === "growth" || effectivePlan === "pro";

  return (
    <>
    {showDeptPicker && effectivePlan && (
      <DepartmentPicker
        plan={effectivePlan}
        onComplete={() => {
          setShowDeptPicker(false);
          setCheckoutBanner(null);
          setTimeout(() => setCheckoutBanner("success"), 50);
          setTimeout(() => setCheckoutBanner(null), 6000);
        }}
      />
    )}
    {showAddDept && (
      <AddDeptModal
        alreadyUnlocked={unlockedDepts}
        onClose={() => setShowAddDept(false)}
      />
    )}
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />
      <div
        className="fixed pointer-events-none"
        style={{
          top: "-200px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "800px",
          height: "600px",
          borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(91,33,232,0.12) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">

        {/* Post-checkout banner */}
        {checkoutBanner === "success" && (
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-3.5 mb-6"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            <span className="text-base">🎉</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#22C55E" }}>
                Welcome to {currentPlan ? PLAN_LABELS[currentPlan] : "your new plan"}
              </p>
              <p className="text-xs" style={{ color: "#4A7A4A" }}>
                Your departments are open for business. Your staff is on duty.
              </p>
            </div>
          </div>
        )}
        {checkoutBanner === "cancelled" && (
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-3.5 mb-6"
            style={{ background: "rgba(91,33,232,0.06)", border: "1px solid rgba(91,33,232,0.2)" }}
          >
            <span className="text-base">👋</span>
            <p className="text-sm" style={{ color: "#7060A0" }}>
              No worries — your trial runs are still available whenever you&apos;re ready.
            </p>
          </div>
        )}

        {/* Addon banners */}
        {addonBanner?.type === "success" && (
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-3.5 mb-6"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            <span className="text-base">✨</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#22C55E" }}>
                {addonBanner.dept ? `${DEPT_LABEL_MAP[addonBanner.dept] ?? addonBanner.dept} added to your team` : "Department added"}
              </p>
              <p className="text-xs" style={{ color: "#4A7A4A" }}>
                Your new specialists are ready. Open the department to get started.
              </p>
            </div>
          </div>
        )}
        {addonBanner?.type === "cancelled" && (
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-3.5 mb-6"
            style={{ background: "rgba(91,33,232,0.06)", border: "1px solid rgba(91,33,232,0.2)" }}
          >
            <span className="text-base">👋</span>
            <p className="text-sm" style={{ color: "#7060A0" }}>
              Add-on checkout cancelled. You can add a department any time.
            </p>
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <a href="/">
            <Image src="/logo-light.png" alt="STAFFD" width={100} height={44} style={{ objectFit: "contain" }} />
          </a>
          <div className="flex items-center gap-4">
            {/* Booking link pill */}
            {bookingSlug && (
              <button
                onClick={() => void copyBookingLink()}
                className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all flex items-center gap-1.5"
                style={{
                  background: bookingLinkCopied ? "rgba(34,197,94,0.15)" : "rgba(91,33,232,0.12)",
                  color: bookingLinkCopied ? "#22C55E" : "#A07BFF",
                  border: bookingLinkCopied ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(91,33,232,0.25)",
                }}
                title="Copy your public booking link"
              >
                <span>📞</span>
                {bookingLinkCopied ? "Link copied ✓" : "Booking link"}
              </button>
            )}
            {/* Plan badge */}
            {effectivePlan && effectivePlan !== "starter" && (
              <button
                onClick={async () => {
                  const userId = pb.authStore.record?.id ?? "";
                  const res = await fetch("/api/stripe/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
                  const data = await res.json() as { url?: string };
                  if (data.url) window.location.href = data.url;
                }}
                className="text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                style={{ background: "rgba(91,33,232,0.15)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.3)" }}
                title="Manage subscription"
              >
                {PLAN_LABELS[effectivePlan] ?? effectivePlan}
              </button>
            )}
            <a href="/dashboard/calendar" className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55", textDecoration: "none" }}>
              Calendar
            </a>
            <a href="/dashboard/library" className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55", textDecoration: "none" }}>
              Library
            </a>
            {/* W95.7.1 — Clients nav + ClientSwitcher hidden pending the W94
               Operator Access System redesign (post-V1). The `clients`
               collection + API are untouched; only the customer-facing UI is
               hidden. */}
            {/* W91 — Front Desk is open to every authenticated user now. */}
            <a href="/dashboard/front-desk" className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55", textDecoration: "none" }}>
              Front Desk
            </a>
            {isAdmin && (
              <a href="/dashboard/admin" className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55", textDecoration: "none" }}>
                Admin
              </a>
            )}
            <a href="/dashboard/settings" style={{ textDecoration: "none" }}>
              {initials ? (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all hover:border-purple-500"
                  style={{ background: "rgba(91,33,232,0.2)", color: "#7C4FF0", border: "1px solid rgba(91,33,232,0.3)", cursor: "pointer" }}
                  title="Account settings"
                >
                  {initials}
                </div>
              ) : (
                <span className="text-xs transition-colors hover:text-white" style={{ color: "#3A3A55" }}>Settings</span>
              )}
            </a>
            <button
              onClick={() => signOut()}
              className="text-sm transition-colors hover:text-white"
              style={{ color: "#5A5A70" }}
            >
              Sign out
            </button>
          </div>
        </header>

        {/* View-as-plan banner — super-admin only, presentation only */}
        {isAdmin && effectivePlan && effectivePlan !== currentPlan && (
          <div
            className="flex items-center justify-between rounded-xl px-4 py-2.5 mb-4 text-xs"
            style={{ background: "rgba(91,33,232,0.1)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF" }}
          >
            <span>Viewing as <strong>{PLAN_LABELS[effectivePlan] ?? effectivePlan}</strong> — presentation only</span>
            <button
              onClick={() => {
                localStorage.removeItem("staffd_view_as_plan");
                window.dispatchEvent(new StorageEvent("storage", { key: "staffd_view_as_plan" }));
              }}
              style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: "12px" }}
            >
              Reset
            </button>
          </div>
        )}

        {/* Welcome */}
        <div className="mb-8">
          <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "2rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            {userName ? `Welcome back, ${userName}.` : "Welcome back."}
          </h1>
          <p className="text-sm" style={{ color: "#5A5A70" }}>
            Your staff is on duty.
          </p>
        </div>

        {/* Vault health nudge — only shown when vault is incomplete */}
        {vaultPct !== null && vaultPct < 75 && (
          <a
            href="/dashboard/vault"
            style={{ textDecoration: "none", display: "block", marginBottom: "20px" }}
          >
            <div
              className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all"
              style={{
                background: "rgba(245,158,11,0.05)",
                border: "1px solid rgba(245,158,11,0.2)",
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}
              >
                ⚡
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#F0F0E8" }}>
                  Your staff is working with {vaultPct}% of the context they need
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#7A6A40" }}>
                  Fill in your Business Vault — the more they know, the better the output →
                </p>
              </div>
              <div
                className="flex-shrink-0"
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "#F59E0B",
                }}
              >
                {vaultPct}%
              </div>
            </div>
          </a>
        )}

        {/* Phase 4 — low-credits warning + topup launcher */}
        <LowCreditsBanner onTopUp={() => setTopupOpen(true)} />
        <TopupModal open={topupOpen} onClose={() => setTopupOpen(false)} />

        {/* Phase 6 — Morning Brief: the autonomous "what your staff did
            overnight" surface. Renders nothing when there's no brief yet. */}
        <MorningBriefCard />

        {/* Phase 7 — PWA install prompt. Only renders when the browser
            fires beforeinstallprompt; dismissible per session. */}
        <InstallPWAModal />

        {/* Command Center chat */}
        <CommandCenter />

        {/* Phase 4 — credit balance card */}
        <div className="mb-8">
          <CreditsWidget />
        </div>

        {/* Utility row: Vault + CEO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <a
            href="/dashboard/vault"
            className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all"
            style={{
              background: "rgba(91,33,232,0.06)",
              border: "1px solid rgba(91,33,232,0.25)",
              textDecoration: "none",
            }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.15)", border: "1px solid rgba(91,33,232,0.25)" }}>
              🔐
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Business Vault</p>
              <p className="text-xs" style={{ color: "#5A5A70" }}>Your business profile for all agents</p>
            </div>
            <span className="text-xs font-semibold" style={{ color: "#5B21E8" }}>Edit →</span>
          </a>

          <a
            href="/dashboard/ceo"
            className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-all"
            style={{
              background: "rgba(91,33,232,0.08)",
              border: "1px solid rgba(91,33,232,0.3)",
              textDecoration: "none",
            }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
              style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.35)" }}>
              🎯
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>The CEO</p>
              <p className="text-xs" style={{ color: "#5A5A70" }}>Strategic advisor & business planning</p>
            </div>
            <span className="text-xs font-semibold" style={{ color: "#5B21E8" }}>Ask →</span>
          </a>
        </div>

        {/* Upcoming calls */}
        {upcomingBookings.length > 0 && (
          <div className="mb-6 rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid rgba(34,197,94,0.2)" }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid #1E1E2A" }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#22C55E" }}>
                Upcoming calls
              </p>
              <a href="/dashboard/calendar" className="text-xs" style={{ color: "#5A5A70", textDecoration: "none" }}>
                See all →
              </a>
            </div>
            <div className="px-5 py-2">
              {upcomingBookings.map((b) => {
                const start = new Date(b.start_time);
                const dateStr = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                const timeStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                return (
                  <div key={b.id} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: "#1E1E2A" }}>
                    <span className="text-base flex-shrink-0">📞</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "#F0F0F8" }}>
                        {b.attendee_name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>
                        {dateStr} · {timeStr} · {b.duration}m
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Department grid */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#3A3A50" }}>
            Go directly to a department
          </p>
          {canAddDept && (
            <button
              onClick={() => setShowAddDept(true)}
              className="text-xs font-semibold transition-colors"
              style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer" }}
            >
              + Add another department · $29/mo
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
          {DEPARTMENTS.map((dept) => (
            <a
              key={dept.name}
              href={dept.href}
              className="rounded-xl p-4 flex flex-col gap-2.5 transition-all group"
              style={{
                background: "#111118",
                border: "1px solid #2A2A38",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(91,33,232,0.5)";
                (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#2A2A38";
                (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
              }}
            >
              <div className="text-xl">{dept.icon}</div>
              <div>
                <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>{dept.name}</p>
                <p className="text-xs mt-0.5 leading-snug" style={{ color: "#3A3A50" }}>{dept.tagline}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
    </>
  );
}
