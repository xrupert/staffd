"use client";

/**
 * Connect Your Tools — per-user vendor credential management (W91).
 *
 * Settings section where a customer supplies THEIR own Twenty / Chatwoot /
 * Listmonk / Plausible / Docuseal instance. Vendor names are shown here by
 * design (D4 — the user is configuring their own vendor and must recognize
 * it); this is the explicit brand-voice exception. Keys are write-only — the
 * API returns a masked hint, never the plaintext.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type Vendor = {
  type: string;
  label: string;
  description: string;
  urlPlaceholder: string;
  configField?: { key: string; label: string; placeholder: string };
};

const VENDORS: Vendor[] = [
  { type: "twenty", label: "Twenty", description: "CRM — contacts & pipeline", urlPlaceholder: "https://crm.yourcompany.com" },
  { type: "chatwoot", label: "Chatwoot", description: "Support inbox", urlPlaceholder: "https://support.yourcompany.com", configField: { key: "account_id", label: "Account ID", placeholder: "1" } },
  { type: "listmonk", label: "Listmonk", description: "Email campaigns", urlPlaceholder: "https://mail.yourcompany.com", configField: { key: "username", label: "Username", placeholder: "admin" } },
  { type: "plausible", label: "Plausible", description: "Site analytics", urlPlaceholder: "https://analytics.yourcompany.com", configField: { key: "site_id", label: "Site ID (domain)", placeholder: "yourcompany.com" } },
  { type: "docuseal", label: "Docuseal", description: "E-signatures", urlPlaceholder: "https://sign.yourcompany.com" },
];

type State = { status: string; masked_key: string; url: string; config: Record<string, unknown>; last_verified_at: string | null; last_error: string | null };

const card: React.CSSProperties = { background: "#15151E", border: "1px solid #2A2A38", borderRadius: "12px", padding: "16px" };
const input: React.CSSProperties = { background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", outline: "none", width: "100%" };

function badge(status: string) {
  if (status === "connected") return { label: "Connected", color: "#22C55E" };
  if (status === "error") return { label: "Error", color: "#F59E0B" };
  return { label: "Not connected", color: "#7070A0" };
}

export default function ConnectYourTools() {
  const [states, setStates] = useState<Record<string, State>>({});
  const [drafts, setDrafts] = useState<Record<string, { url: string; key: string; config: Record<string, string> }>>({});
  const [busy, setBusy] = useState<string>("");
  const [notice, setNotice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/user-integrations?pbToken=${encodeURIComponent(pb.authStore.token)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { integrations: (State & { type: string })[] };
      const map: Record<string, State> = {};
      for (const i of data.integrations) map[i.type] = i;
      setStates(map);
    } catch { /* leave empty */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function draftFor(type: string): { url: string; key: string; config: Record<string, string> } {
    return drafts[type] ?? { url: states[type]?.url ?? "", key: "", config: {} };
  }
  function setDraft(type: string, patch: Partial<{ url: string; key: string; config: Record<string, string> }>) {
    setDrafts((d) => ({ ...d, [type]: { ...draftFor(type), ...patch } }));
  }

  async function save(v: Vendor) {
    const d = draftFor(v.type);
    setBusy(v.type); setNotice((n) => ({ ...n, [v.type]: "" }));
    try {
      const res = await fetch(`/api/user-integrations/${v.type}?pbToken=${encodeURIComponent(pb.authStore.token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_url: d.url, api_key: d.key, additional_config: d.config }),
      });
      if (!res.ok) { setNotice((n) => ({ ...n, [v.type]: "Couldn't save." })); return; }
      await test(v, true); // verify right after saving
      await load();
    } finally { setBusy(""); }
  }

  async function test(v: Vendor, quiet = false) {
    if (!quiet) setBusy(v.type);
    try {
      const res = await fetch(`/api/user-integrations/${v.type}/test?pbToken=${encodeURIComponent(pb.authStore.token)}`, { method: "POST" });
      const data = (await res.json()) as { connected: boolean; error?: string };
      setNotice((n) => ({ ...n, [v.type]: data.connected ? "Connected ✓" : `Error: ${data.error ?? "connection failed"}` }));
      await load();
    } finally { if (!quiet) setBusy(""); }
  }

  async function disconnect(v: Vendor) {
    setBusy(v.type);
    try {
      await fetch(`/api/user-integrations/${v.type}?pbToken=${encodeURIComponent(pb.authStore.token)}`, { method: "DELETE" });
      setDrafts((d) => ({ ...d, [v.type]: { url: "", key: "", config: {} } }));
      setNotice((n) => ({ ...n, [v.type]: "Disconnected." }));
      await load();
    } finally { setBusy(""); }
  }

  return (
    <section id="connect-your-tools" className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38", scrollMarginTop: "80px" }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: "#F0F0F8" }}>Connect Your Tools</h2>
      <p className="text-xs mb-5" style={{ color: "#7070A0" }}>Bring your own tools — your data shows up across STAFFD. Keys are encrypted and never shown again after saving.</p>
      <div className="flex flex-col gap-3">
        {VENDORS.map((v) => {
          const s = states[v.type]; const d = draftFor(v.type); const b = badge(s?.status ?? "disconnected");
          return (
            <div key={v.type} style={card}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{v.label}</span>
                  <span className="text-xs ml-2" style={{ color: "#5A5A70" }}>{v.description}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${b.color}22`, color: b.color, border: `1px solid ${b.color}55` }}>{b.label}</span>
              </div>
              <div className="flex flex-col gap-2">
                <input style={input} placeholder={v.urlPlaceholder} value={d.url} onChange={(e) => setDraft(v.type, { url: e.target.value })} />
                <input style={input} type="password" placeholder={s?.masked_key && s.masked_key !== "(not configured)" ? s.masked_key : "API key"} value={d.key} onChange={(e) => setDraft(v.type, { key: e.target.value })} />
                {v.configField && (
                  <input style={input} placeholder={`${v.configField.label} — ${v.configField.placeholder}`} value={d.config[v.configField.key] ?? (s?.config?.[v.configField.key] as string ?? "")} onChange={(e) => setDraft(v.type, { config: { ...d.config, [v.configField!.key]: e.target.value } })} />
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button disabled={busy === v.type} onClick={() => void save(v)} className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ opacity: busy === v.type ? 0.5 : 1 }}>Save</button>
                <button disabled={busy === v.type} onClick={() => void test(v)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(91,33,232,0.12)", border: "1px solid rgba(91,33,232,0.3)", color: "#A07BFF" }}>Test Connection</button>
                {s && s.status !== "disconnected" && (
                  <button disabled={busy === v.type} onClick={() => void disconnect(v)} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>Disconnect</button>
                )}
                {notice[v.type] && <span className="text-xs" style={{ color: notice[v.type]?.startsWith("Error") ? "#F59E0B" : "#A07BFF" }}>{notice[v.type]}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
