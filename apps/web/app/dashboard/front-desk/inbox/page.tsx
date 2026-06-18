"use client";

/**
 * /dashboard/front-desk/inbox — support inbox (W95.6, READ-only).
 *
 * Top-10 open conversations for this customer's inbox (inbox-per-customer
 * partition, server-side). Row → SideDrawer with the full thread (oldest-first).
 * Reply is disabled with an honest "coming in next update" tooltip (Standard
 * #21 — no fake button; replies land in W95.6.1). Zero "Chatwoot" branding.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";
import SideDrawer from "../../../components/SideDrawer";

type Conversation = { id: number; sender: string; snippet: string; status: string; lastAt: string };
type Message = { id: number; content: string; outgoing: boolean; createdAt: string };

export default function InboxPage() {
  const [convos, setConvos] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/front-desk/inbox", { headers: { Authorization: pb.authStore.token } });
      setConvos(res.ok ? ((await res.json()).conversations as Conversation[]) ?? [] : []);
    } catch { setConvos([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (c: Conversation) => {
    setActive(c); setMessages(null);
    try {
      const res = await fetch(`/api/front-desk/inbox/${c.id}`, { headers: { Authorization: pb.authStore.token } });
      setMessages(res.ok ? ((await res.json()).messages as Message[]) ?? [] : []);
    } catch { setMessages([]); }
  }, []);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="w-full max-w-2xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Front Desk</a>
        </header>

        <h1 className="font-bold mb-5" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>Support inbox</h1>

        {convos === null ? <p className="text-sm" style={{ color: "#7070A0" }}>Loading…</p>
          : convos.length === 0 ? <p className="text-sm" style={{ color: "#9090A8" }}>Inbox clear — your specialist will draft replies as messages come in.</p>
          : (
            <ul className="space-y-2">
              {convos.map((c) => (
                <li key={c.id}>
                  <button onClick={() => void open(c)} className="w-full text-left rounded-xl px-4 py-3 transition-colors" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium truncate" style={{ color: "#E8E8F4" }}>{c.sender}</span>
                      <span className="text-xs shrink-0" style={{ color: "#5A5A70" }}>{new Date(c.lastAt).toLocaleDateString()}</span>
                    </div>
                    {c.snippet && <p className="text-xs mt-0.5 truncate" style={{ color: "#9090A8" }}>{c.snippet}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>

      <SideDrawer open={!!active} title={active?.sender ?? ""} onClose={() => setActive(null)}>
        {active && (
          <>
            {messages === null ? <p className="text-sm" style={{ color: "#7070A0" }}>Loading…</p>
              : messages.length === 0 ? <p className="text-sm" style={{ color: "#9090A8" }}>No messages.</p>
              : (
                <div className="space-y-3 mb-6">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-lg px-3 py-2 text-sm" style={{ background: m.outgoing ? "rgba(91,33,232,0.12)" : "#15151E", border: "1px solid #23232E", marginLeft: m.outgoing ? "24px" : 0, marginRight: m.outgoing ? 0 : "24px" }}>
                      <p style={{ color: "#D0D0E0" }}>{m.content}</p>
                      <p className="text-xs mt-1" style={{ color: "#5A5A70" }}>{m.outgoing ? "You" : active.sender} · {new Date(m.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            <button disabled title="Coming in next update" className="text-xs px-3 py-2 rounded-lg font-medium" style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#5A5A70", cursor: "not-allowed" }}>
              Reply (coming in next update)
            </button>
          </>
        )}
      </SideDrawer>
    </main>
  );
}
