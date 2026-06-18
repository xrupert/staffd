"use client";

/**
 * /dashboard/front-desk/drafts — review step UI (W95.6.x).
 *
 * Workflows paused at awaiting_review. Row → SideDrawer with the specialist's
 * draft in an editable textarea + [Approve & Send] / [Cancel]. Approve sends
 * any edits through; cancel stops the workflow. STAFFD voice ("your specialist
 * drafted this"); "Approve & Send", never a vendor name.
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";
import SideDrawer from "../../../components/SideDrawer";

type Draft = { id: string; kind: string; goal: string; preview: string; draft: string; created: string };

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [active, setActive] = useState<Draft | null>(null);
  const [edited, setEdited] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/front-desk/drafts", { headers: { Authorization: pb.authStore.token } });
      setDrafts(res.ok ? ((await res.json()).drafts as Draft[]) ?? [] : []);
    } catch { setDrafts([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (id: string, action: "approve" | "cancel", editedDraft?: string) => {
    setBusy(true);
    try {
      await fetch(`/api/workflows/${id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify(action === "approve" && editedDraft ? { edited_draft: editedDraft } : {}),
      });
    } catch { /* reflect on reload */ }
    finally { setBusy(false); setActive(null); await load(); }
  }, [load]);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="w-full max-w-2xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Front Desk</a>
        </header>

        <h1 className="font-bold mb-1" style={{ color: "#F0F0F8", fontSize: "1.5rem" }}>Drafts awaiting your review</h1>
        <p className="text-sm mb-5" style={{ color: "#9090A8" }}>Your specialists drafted these. Review, tweak, and send — or cancel.</p>

        {drafts === null ? <p className="text-sm" style={{ color: "#7070A0" }}>Loading…</p>
          : drafts.length === 0 ? <p className="text-sm" style={{ color: "#9090A8" }}>No drafts waiting — your specialists are on call.</p>
          : (
            <ul className="space-y-2">
              {drafts.map((d) => (
                <li key={d.id}>
                  <button onClick={() => { setActive(d); setEdited(d.draft); }} className="w-full text-left rounded-xl px-4 py-3" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium" style={{ color: "#A07BFF" }}>{d.kind}</span>
                      <span className="text-xs" style={{ color: "#5A5A70" }}>{new Date(d.created).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs mt-1 truncate" style={{ color: "#9090A8" }}>{d.preview || d.goal}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>

      <SideDrawer open={!!active} title={active ? `${active.kind} draft` : ""} onClose={() => { if (!busy) setActive(null); }}>
        {active && (
          <>
            <label className="text-xs uppercase tracking-wider" style={{ color: "#6060A0" }}>Your specialist&apos;s draft</label>
            <textarea value={edited} onChange={(e) => setEdited(e.target.value)} rows={10}
              className="w-full mt-1 mb-4 rounded-lg p-3 text-sm" style={{ background: "#15151E", border: "1px solid #2A2A38", color: "#E8E8F4", outline: "none" }} />
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => void act(active.id, "approve", edited !== active.draft ? edited : undefined)}
                className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50">
                {busy ? "Sending…" : "Approve & Send"}
              </button>
              <button disabled={busy} onClick={() => void act(active.id, "cancel")}
                className="px-4 py-2 rounded-xl text-xs" style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </SideDrawer>
    </main>
  );
}
