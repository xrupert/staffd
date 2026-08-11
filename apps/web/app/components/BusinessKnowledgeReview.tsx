"use client";

import { useCallback, useEffect, useState } from "react";

type Knowledge = {
  id: string;
  kind: string;
  subject: string;
  statement: string;
  confidence: number;
  reviewStatus?: string;
  sources: Array<{ title: string }>;
};

export default function BusinessKnowledgeReview() {
  const [items, setItems] = useState<Knowledge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Knowledge | null>(null);
  const [subject, setSubject] = useState("");
  const [statement, setStatement] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/business-knowledge?stage=observed", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as { items?: Knowledge[] };
      setItems((payload.items ?? []).filter((item) => !item.reviewStatus || item.reviewStatus === "pending"));
    } catch { setError("STAFFD could not load knowledge awaiting review."); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(item: Knowledge, decision: "approve" | "reject" | "supersede") {
    setBusy(item.id); setError("");
    try {
      const response = await fetch("/api/business-knowledge/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, decision, replacement: decision === "supersede" ? { subject, statement } : undefined }),
      });
      if (!response.ok) throw new Error();
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setEditing(null);
    } catch { setError("That review could not be saved. Please try again."); }
    finally { setBusy(null); }
  }

  if (!items.length && !error) return null;

  return (
    <section className="rounded-2xl p-6 mt-6" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div><h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Knowledge awaiting your review</h2><p className="text-xs mt-1" style={{ color: "#9090A8" }}>Nothing here becomes trusted operating policy until you approve it.</p></div>
        <span className="text-xs rounded-full px-2 py-1" style={{ color: "#A07BFF", background: "rgba(160,123,255,.12)" }}>{items.length}</span>
      </div>
      {error && <p role="alert" className="text-xs mb-3" style={{ color: "#F87171" }}>{error}</p>}
      <ul className="flex flex-col gap-3">
        {items.map((item) => <li key={item.id} className="rounded-xl p-4" style={{ background: "#0D0D16", border: "1px solid #1E1E2A" }}>
          {editing?.id === item.id ? <div className="flex flex-col gap-3">
            <input aria-label="Knowledge subject" value={subject} onChange={(event) => setSubject(event.target.value)} className="rounded-lg px-3 py-2 text-sm" style={{ background: "#151520", color: "#F0F0F8", border: "1px solid #2A2A38" }} />
            <textarea aria-label="Knowledge statement" value={statement} onChange={(event) => setStatement(event.target.value)} rows={3} className="rounded-lg px-3 py-2 text-sm" style={{ background: "#151520", color: "#F0F0F8", border: "1px solid #2A2A38" }} />
            <div className="flex gap-2"><button disabled={busy === item.id || !subject.trim() || !statement.trim()} onClick={() => void decide(item, "supersede")} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "#5B21E8", color: "white" }}>Approve replacement</button><button onClick={() => setEditing(null)} className="px-3 py-2 text-xs" style={{ color: "#9090A8" }}>Cancel</button></div>
          </div> : <>
            <div className="flex items-center gap-2 mb-2"><span className="text-xs uppercase tracking-wide" style={{ color: "#A07BFF" }}>{item.kind}</span><span className="text-xs" style={{ color: "#606078" }}>{Math.round(item.confidence * 100)}% confidence</span></div>
            <h3 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{item.subject}</h3><p className="text-sm mt-1 leading-relaxed" style={{ color: "#B0B0C3" }}>{item.statement}</p>
            <p className="text-xs mt-2" style={{ color: "#606078" }}>Source: {item.sources.map((source) => source.title).join(", ")}</p>
            <div className="flex flex-wrap gap-2 mt-4"><button disabled={busy === item.id} onClick={() => void decide(item, "approve")} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "#5B21E8", color: "white" }}>Approve</button><button disabled={busy === item.id} onClick={() => { setEditing(item); setSubject(item.subject); setStatement(item.statement); }} className="rounded-lg px-3 py-2 text-xs" style={{ border: "1px solid #3A3A50", color: "#C0C0D0" }}>Edit & approve</button><button disabled={busy === item.id} onClick={() => void decide(item, "reject")} className="px-3 py-2 text-xs" style={{ color: "#F87171" }}>Reject</button></div>
          </>}
        </li>)}
      </ul>
    </section>
  );
}
