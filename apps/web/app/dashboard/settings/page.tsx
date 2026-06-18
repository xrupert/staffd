"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../../lib/pb";
import { signOut } from "../../../lib/auth/signOut";
import SchedulingSettings from "../../components/SchedulingSettings";
import ConnectedAccounts from "../../components/ConnectedAccounts";
import VoiceProfilePanel from "../../components/VoiceProfilePanel";
import PushNotificationsToggle from "../../components/PushNotificationsToggle";
import IndustryPacksPanel from "../../components/IndustryPacksPanel";
import VaultEditor from "../../components/VaultEditor";
import AutopilotControlsPanel from "../../components/AutopilotControlsPanel";
import AutomationSettings from "../../components/AutomationSettings";
import BriefPreferencesPanel from "../../components/BriefPreferencesPanel";

export default function SettingsPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [openingBilling, setOpeningBilling] = useState(false);
  const [billingMsg, setBillingMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    const record = pb.authStore.record;
    setName((record?.name as string) ?? "");
    setEmail((record?.email as string) ?? "");
  }, []);

  // MX-7 — open the Stripe customer portal for self-service billing
  // (update card, change plan, cancel). Redirects to the hosted portal.
  async function openBilling() {
    setOpeningBilling(true);
    setBillingMsg(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) { window.location.href = data.url; return; }
      setBillingMsg({ text: data.error ?? "Couldn't open billing — try again.", ok: false });
    } catch {
      setBillingMsg({ text: "Couldn't reach billing right now.", ok: false });
    } finally {
      setOpeningBilling(false);
    }
  }

  async function saveProfile() {
    if (!name.trim()) { setProfileMsg({ text: "Name is required.", ok: false }); return; }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      await pb.collection("users").update(userId, { name: name.trim() });

      const currentEmail = pb.authStore.record?.email as string;
      if (email.trim() && email.trim() !== currentEmail) {
        await pb.collection("users").requestEmailChange(email.trim());
        setProfileMsg({ text: "Name saved. A verification email has been sent to your new address — confirm it to complete the email change.", ok: true });
      } else {
        setProfileMsg({ text: "Profile saved.", ok: true });
      }
    } catch {
      setProfileMsg({ text: "Failed to save. Try again.", ok: false });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMsg({ text: "All three fields are required.", ok: false }); return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: "New passwords don't match.", ok: false }); return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ text: "New password must be at least 8 characters.", ok: false }); return;
    }
    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      await pb.collection("users").update(userId, {
        oldPassword: currentPassword,
        password: newPassword,
        passwordConfirm: confirmPassword,
      });
      setPasswordMsg({ text: "Password changed. You'll need to sign in again.", ok: true });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setTimeout(() => {
        localStorage.removeItem("staffd_view_as_plan");
        pb.authStore.clear();
        window.location.href = "/auth/login";
      }, 2000);
    } catch {
      setPasswordMsg({ text: "Incorrect current password, or password change failed.", ok: false });
    } finally {
      setSavingPassword(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "#111118",
    border: "1px solid #2A2A38",
    color: "#F0F0F8",
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "14px",
    outline: "none",
    width: "100%",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "12px",
    fontWeight: 500,
    marginBottom: "6px",
    color: "#9090A8",
  };

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-12">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard" className="text-sm transition-colors hover:text-white" style={{ color: "#5A5A70" }}>
            ← Dashboard
          </a>
        </header>

        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>Account</p>
          <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.75rem", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
            Settings
          </h1>
        </div>

        {/* Profile section */}
        <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: "#F0F0F8" }}>Profile</h2>

          <div className="flex flex-col gap-4">
            <div>
              <label style={labelStyle}>Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inputStyle}
              />
              <p className="text-xs mt-1.5" style={{ color: "#3A3A55" }}>
                Changing your email sends a verification link to the new address.
              </p>
            </div>
          </div>

          {profileMsg && (
            <div
              className="mt-4 px-4 py-3 rounded-xl text-xs"
              style={{
                background: profileMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${profileMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: profileMsg.ok ? "#22C55E" : "#EF4444",
              }}
            >
              {profileMsg.text}
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button
              onClick={() => void saveProfile()}
              disabled={savingProfile}
              className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ opacity: savingProfile ? 0.5 : 1 }}
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </button>
          </div>
        </section>

        {/* Autopilot controls (Phase 9) */}
        <AutopilotControlsPanel />

        {/* W95.5 — conversational-intent autopilot (graduated actions) */}
        <AutomationSettings />

        {/* Morning Brief delivery preferences (Phase 26) */}
        <BriefPreferencesPanel />

        {/* Voice profile (Phase 2) */}
        <VoiceProfilePanel />

        {/* Push notifications (Phase 7) */}
        <PushNotificationsToggle />

        {/* W50 — expanded business profile (D-21 substrate) */}
        <VaultEditor />

        {/* Industry packs (Phase 8) */}
        <IndustryPacksPanel />

        {/* Scheduling section */}
        <SchedulingSettings />

        {/* Connected social accounts */}
        {/* Billing section (MX-7) — self-service via Stripe customer portal */}
        <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Billing</h2>
          <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>
            Manage your plan, update your payment method, view invoices, or cancel — in Stripe&apos;s secure portal.
          </p>
          {billingMsg && (
            <div
              className="px-4 py-3 rounded-xl text-xs mb-4"
              style={{
                background: billingMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${billingMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: billingMsg.ok ? "#22C55E" : "#EF4444",
              }}
            >
              {billingMsg.text}
            </div>
          )}
          <button
            onClick={() => void openBilling()}
            disabled={openingBilling}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white btn-primary"
            style={{ opacity: openingBilling ? 0.6 : 1 }}
          >
            {openingBilling ? "Opening…" : "Manage billing →"}
          </button>
        </section>

        <ConnectedAccounts />

        {/* Password section */}
        <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <h2 className="text-sm font-semibold mb-5" style={{ color: "#F0F0F8" }}>Change password</h2>

          <div className="flex flex-col gap-4">
            <div>
              <label style={labelStyle}>Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
          </div>

          {passwordMsg && (
            <div
              className="mt-4 px-4 py-3 rounded-xl text-xs"
              style={{
                background: passwordMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${passwordMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: passwordMsg.ok ? "#22C55E" : "#EF4444",
              }}
            >
              {passwordMsg.text}
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button
              onClick={() => void changePassword()}
              disabled={savingPassword}
              className="btn-primary px-5 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ opacity: savingPassword ? 0.5 : 1 }}
            >
              {savingPassword ? "Updating…" : "Update password"}
            </button>
          </div>
        </section>

        {/* Privacy & data (GDPR — PR-Tranche-2) */}
        <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Privacy &amp; data</h2>
          <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>
            Download everything STAFFD stores about you, or permanently delete your account. Both honor your GDPR / CCPA rights.
          </p>
          <PrivacyControls />
        </section>

        {/* Danger zone */}
        <section className="rounded-2xl p-6" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Sign out</h2>
          <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>Sign out of your account on this device.</p>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
          >
            Sign out
          </button>
        </section>
      </div>
    </main>
  );
}

/**
 * PR-Tranche-2 Item 1 — GDPR data export + account deletion controls.
 *
 * Download My Data → POST /api/account/export-data, triggers JSON download.
 * Delete Account   → confirm dialog with email-type-to-confirm pattern;
 *                    POST /api/account/delete; on success, log out + redirect.
 */
function PrivacyControls(): React.JSX.Element {
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const userEmail = (pb.authStore.record?.email as string) ?? "";

  async function downloadData() {
    if (downloading) return;
    setDownloading(true);
    setDownloadMsg(null);
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/account/export-data?pbToken=${encodeURIComponent(token)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDownloadMsg(`Export failed: ${(data as { error?: string }).error ?? `error_${res.status}`}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `staffd-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadMsg("Your archive is downloading.");
    } catch {
      setDownloadMsg("Export failed: network error.");
    } finally {
      setDownloading(false);
    }
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setDeleteMsg(null);
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/account/delete?pbToken=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_email: confirmEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = (data as { error?: string; message?: string });
        setDeleteMsg(err.message ?? `Delete failed: ${err.error ?? `error_${res.status}`}`);
        return;
      }
      // Success — log out + redirect
      localStorage.removeItem("staffd_view_as_plan");
      pb.authStore.clear();
      window.location.href = "/?account_deleted=1";
    } catch {
      setDeleteMsg("Delete failed: network error.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void downloadData()}
          disabled={downloading}
          className="px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
          style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8", opacity: downloading ? 0.5 : 1 }}
        >
          {downloading ? "Preparing…" : "Download my data"}
        </button>
        {downloadMsg && <span className="text-xs" style={{ color: "#A07BFF" }}>{downloadMsg}</span>}
      </div>

      {!deleteOpen ? (
        <button
          onClick={() => setDeleteOpen(true)}
          className="px-4 py-2 rounded-xl text-xs font-semibold transition-colors self-start"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
        >
          Delete my account
        </button>
      ) : (
        <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <p className="text-sm font-semibold mb-2" style={{ color: "#EF4444" }}>This permanently erases your account.</p>
          <p className="text-xs mb-3" style={{ color: "#D0D0E8" }}>
            Type <code style={{ color: "#A07BFF" }}>{userEmail}</code> to confirm. Your active subscription will be cancelled and every document, conversation, brief, and vault row owned by you will be deleted. This cannot be undone.
          </p>
          <input
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={userEmail}
            className="w-full text-xs px-3 py-2 rounded mb-3"
            style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E8" }}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => void deleteAccount()}
              disabled={deleting || confirmEmail.trim().toLowerCase() !== userEmail.trim().toLowerCase()}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
              style={{
                background: "#EF4444",
                color: "#fff",
                border: "1px solid #EF4444",
                opacity: (deleting || confirmEmail.trim().toLowerCase() !== userEmail.trim().toLowerCase()) ? 0.5 : 1,
              }}
            >
              {deleting ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              onClick={() => { setDeleteOpen(false); setConfirmEmail(""); setDeleteMsg(null); }}
              disabled={deleting}
              className="text-xs"
              style={{ color: "#7070A0", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
          {deleteMsg && <p className="text-xs mt-2" style={{ color: "#EF4444" }}>{deleteMsg}</p>}
        </div>
      )}
    </div>
  );
}
