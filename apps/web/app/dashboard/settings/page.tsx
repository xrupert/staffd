"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import pb from "../../../lib/pb";

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

  useEffect(() => {
    if (!pb.authStore.isValid) { window.location.href = "/auth/login"; return; }
    const record = pb.authStore.record;
    setName((record?.name as string) ?? "");
    setEmail((record?.email as string) ?? "");
  }, []);

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

        {/* Danger zone */}
        <section className="rounded-2xl p-6" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "#F0F0F8" }}>Sign out</h2>
          <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>Sign out of your account on this device.</p>
          <button
            onClick={() => { pb.authStore.clear(); window.location.href = "/"; }}
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
