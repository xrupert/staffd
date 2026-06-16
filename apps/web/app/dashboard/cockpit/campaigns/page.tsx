"use client";

/**
 * /dashboard/cockpit/campaigns — Email Campaigns native surface (W80.2).
 *
 * List / detail / compose over the operator's email tool, in STAFFD's shell.
 * No vendor name appears anywhere. Super-admin gated; the write route is
 * authed and the reads were gated in W80.1. "Make this smart →" hands the
 * draft to the email specialist via the Command Center (surface→specialist).
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";
import { isSuperAdminClient } from "../../../../lib/hooks/useEffectivePlan";
import { campaignStatusLabel, buildCampaignSmartPrompt } from "../../../../lib/operations";

type Campaign = { id: number; name: string; status: string; sent: number; toSend: number; openRate: number; sendAt: string | null; createdAt: string | null };
type Detail = { id: number; name: string; subject: string; status: string; sent: number; toSend: number; views: number; clicks: number; bounces: number; openRate: number; sendAt: string | null; preview: string };
type ListOption = { id: number; name: string; subscribers: number };
type View = "list" | "detail" | "compose";

const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px" };
const input: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8", borderRadius: "12px", padding: "10px 14px", fontSize: "13px", outline: "none", width: "100%" };

async function api(path: string, init?: RequestInit) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${path}${sep}pbToken=${encodeURIComponent(pb.authStore.token)}`, init);
}

export default function CampaignsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("list");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [error, setError] = useState("");

  // Compose form
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [sendAt, setSendAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    setError("");
    try {
      const res = await api("/api/integrations/listmonk?limit=50");
      if (res.status === 503) { setCampaigns([]); setError("Email isn't connected yet."); return; }
      if (!res.ok) { setCampaigns([]); setError("Couldn't load campaigns."); return; }
      setCampaigns((await res.json()).campaigns ?? []);
    } catch { setCampaigns([]); setError("Couldn't load campaigns."); }
  }, []);

  useEffect(() => {
    const admin = isSuperAdminClient((pb.authStore.record as { email?: string } | null)?.email);
    setIsAdmin(admin);
    if (admin) void loadList();
  }, [loadList]);

  async function openDetail(id: number) {
    setView("detail"); setDetail(null);
    try {
      const res = await api(`/api/integrations/listmonk?campaign_id=${id}`);
      if (res.ok) setDetail((await res.json()).campaign);
    } catch { /* detail stays null → "couldn't load" */ }
  }

  async function openCompose() {
    setView("compose"); setSubject(""); setBody(""); setChosen([]); setSendAt(""); setNotice("");
    try {
      const res = await api("/api/integrations/listmonk?resource=lists");
      if (res.ok) setLists((await res.json()).lists ?? []);
    } catch { /* no lists → send to no one until picked */ }
  }

  async function createDraft(): Promise<number | null> {
    const res = await fetch("/api/integrations/listmonk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body, listIds: chosen, userId: pb.authStore.record?.id }),
    });
    const data = (await res.json()) as { success?: boolean; campaignId?: number };
    return res.ok && data.success ? (data.campaignId ?? null) : null;
  }

  async function changeStatus(campaignId: number, action: "send" | "schedule") {
    return api("/api/integrations/listmonk", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, action, sendAt: action === "schedule" ? new Date(sendAt).toISOString() : undefined, userId: pb.authStore.record?.id }),
    });
  }

  async function submit(action: "draft" | "send" | "schedule") {
    if (!subject.trim() || !body.trim()) { setNotice("Add a subject and body first."); return; }
    if (action === "schedule" && !sendAt) { setNotice("Pick a date and time to schedule."); return; }
    setBusy(true); setNotice("");
    try {
      const id = await createDraft();
      if (!id) { setNotice("Couldn't save the campaign — try again."); return; }
      if (action === "draft") { setNotice("Saved as a draft."); }
      else {
        const r = await changeStatus(id, action);
        if (!r.ok) { setNotice("Saved as a draft, but couldn't " + (action === "send" ? "send" : "schedule") + " — finish it from the list."); }
        else { setNotice(action === "send" ? "Sending now." : "Scheduled."); }
      }
      await loadList();
      setTimeout(() => setView("list"), 900);
    } catch { setNotice("Something went wrong — try again."); }
    finally { setBusy(false); }
  }

  if (isAdmin === false) {
    return <Shell><div style={{ ...card, textAlign: "center", padding: "40px" }}><p className="text-sm" style={{ color: "#9090A8" }}>Your email campaigns will live here once your account is connected.</p></div></Shell>;
  }

  return (
    <Shell>
      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>Email Campaigns</h1>
            <button onClick={() => void openCompose()} className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white">+ New campaign</button>
          </div>
          {error && <div className="px-4 py-3 rounded-xl text-xs mb-4" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}>{error}</div>}
          {campaigns === null ? <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>
            : campaigns.length === 0 && !error ? <div style={{ ...card, textAlign: "center" }}><p className="text-sm" style={{ color: "#5A5A70" }}>No campaigns yet. Create your first one →</p></div>
            : (
            <div className="flex flex-col gap-2">
              {campaigns.map((c) => (
                <button key={c.id} onClick={() => void openDetail(c.id)} className="text-left transition-transform hover:-translate-y-px" style={{ ...card, padding: "14px 18px" }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "#F0F0F8" }}>{c.name || "Untitled"}</p>
                      <p className="text-xs" style={{ color: "#5A5A70" }}>{c.toSend ? `${c.toSend.toLocaleString()} recipients` : "—"}{c.sent ? ` · ${c.openRate}% opens` : ""}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={statusStyle(c.status)}>{campaignStatusLabel(c.status)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {view === "detail" && (
        <>
          <button onClick={() => setView("list")} className="text-xs mb-4" style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer" }}>← All campaigns</button>
          {!detail ? <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p> : (
            <div style={card}>
              <span className="text-xs px-2 py-0.5 rounded-full" style={statusStyle(detail.status)}>{campaignStatusLabel(detail.status)}</span>
              <h2 className="font-bold mt-2 mb-1" style={{ color: "#F0F0F8", fontSize: "1.25rem" }}>{detail.name || "Untitled"}</h2>
              <p className="text-xs mb-5" style={{ color: "#7070A0" }}>{detail.subject}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <Metric label="Recipients" value={(detail.toSend || detail.sent).toLocaleString()} />
                <Metric label="Sent" value={detail.sent.toLocaleString()} />
                <Metric label="Open rate" value={`${detail.openRate}%`} />
                <Metric label="Clicks" value={detail.clicks.toLocaleString()} />
              </div>
              {detail.preview && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Content preview</p>
                  <div className="rounded-xl p-4 text-xs" style={{ background: "#0D0D16", border: "1px solid #2A2A38", color: "#9090A8", maxHeight: "240px", overflow: "auto" }}>
                    {detail.preview.replace(/<[^>]+>/g, " ").slice(0, 1200)}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {view === "compose" && (
        <>
          <button onClick={() => setView("list")} className="text-xs mb-4" style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer" }}>← All campaigns</button>
          <div style={card}>
            <h2 className="font-bold mb-4" style={{ color: "#F0F0F8", fontSize: "1.25rem" }}>New campaign</h2>
            <div className="flex flex-col gap-4">
              <Field label="Subject"><input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your subject line" /></Field>
              <Field label="Body" hint="Plain text or basic HTML.">
                <textarea style={{ ...input, minHeight: "160px", lineHeight: 1.6, resize: "vertical" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your email…" />
              </Field>
              <Field label="Send to">
                {lists.length === 0 ? <p className="text-xs" style={{ color: "#5A5A70" }}>No audiences available.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {lists.map((l) => {
                      const on = chosen.includes(l.id);
                      return <button key={l.id} onClick={() => setChosen((p) => on ? p.filter((x) => x !== l.id) : [...p, l.id])} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: on ? "rgba(91,33,232,0.15)" : "#1A1A24", border: `1px solid ${on ? "rgba(91,33,232,0.5)" : "#2A2A38"}`, color: on ? "#A07BFF" : "#7070A0", cursor: "pointer" }}>{l.name} ({l.subscribers.toLocaleString()})</button>;
                    })}
                  </div>
                )}
              </Field>
              <Field label="Schedule for (optional)"><input type="datetime-local" style={input} value={sendAt} onChange={(e) => setSendAt(e.target.value)} /></Field>

              {notice && <p className="text-xs" style={{ color: "#A07BFF" }}>{notice}</p>}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button disabled={busy} onClick={() => void submit("draft")} className="px-4 py-2 rounded-xl text-xs font-semibold" style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF", opacity: busy ? 0.5 : 1 }}>Save draft</button>
                <button disabled={busy} onClick={() => void submit("schedule")} className="px-4 py-2 rounded-xl text-xs font-semibold" style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF", opacity: busy ? 0.5 : 1 }}>Schedule</button>
                <button disabled={busy} onClick={() => void submit("send")} className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white" style={{ opacity: busy ? 0.5 : 1 }}>Send now</button>
                <a href={`/dashboard?ask=${encodeURIComponent(buildCampaignSmartPrompt(subject, body))}`} className="text-xs px-3 py-2 rounded-lg ml-auto" style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF", textDecoration: "none" }}>✨ Make this smart →</a>
              </div>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function statusStyle(status: string): React.CSSProperties {
  const ok = status === "finished";
  const live = status === "running" || status === "scheduled";
  return { background: ok ? "rgba(34,197,94,0.1)" : live ? "rgba(91,33,232,0.12)" : "#1A1A24", color: ok ? "#22C55E" : live ? "#A07BFF" : "#7070A0", border: `1px solid ${ok ? "rgba(34,197,94,0.3)" : live ? "rgba(91,33,232,0.3)" : "#2A2A38"}`, fontSize: "11px" };
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl p-3" style={{ background: "#1A1A24", border: "1px solid #2A2A38" }}><p className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.25rem" }}>{value}</p><p className="text-xs" style={{ color: "#5A5A70" }}>{label}</p></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6060A0" }}>{label}{hint && <span className="ml-2 normal-case font-normal" style={{ color: "#4A4A65" }}>{hint}</span>}</label>{children}</div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`, backgroundSize: "64px 64px" }} />
      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/cockpit" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Cockpit</a>
        </header>
        {children}
      </div>
    </main>
  );
}
