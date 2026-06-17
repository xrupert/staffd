"use client";

/**
 * /dashboard/upload — cold-start data ingestion (W95.3, Model B3).
 *
 * Two surfaces: bring your contacts (CSV) and your documents into STAFFD so
 * your staff have context from day one. STAFFD voice throughout — no vendor
 * names, no "connect your account". The owner uploads; the staff take it from
 * there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import pb from "../../../lib/pb";

const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "28px" };
const label = { color: "#F0F0F8" };
const muted = { color: "#9090A8" };
const faint = { color: "#5A5A70" };

type UploadResult =
  | { ok: boolean; total: number; succeeded: number; failed: number; errors: { row: number; reason: string }[] }
  | { error: string; detail?: string };
type Session = { id: string; kind: string; summary?: string; succeeded?: number; failed?: number; created: string };

// Lightweight client-side preview parse (display only — the server is the
// authority). Splits on newlines, naive comma split (good enough for a glance).
function previewRows(text: string, max = 5): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return { headers: split(lines[0]!), rows: lines.slice(1, max + 1).map(split) };
}

const KNOWN = ["name", "email", "phone", "context"];

export default function UploadPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const loadSessions = useCallback(async () => {
    try {
      const token = pb.authStore.token;
      const res = await fetch("/api/upload/sessions", { headers: token ? { Authorization: token } : {} });
      if (res.ok) setSessions(((await res.json()).sessions as Session[]) ?? []);
    } catch { /* empty state */ }
  }, []);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="relative z-10 w-full max-w-2xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard"><Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/front-desk" className="text-xs transition-colors hover:text-white" style={{ ...faint, textDecoration: "none" }}>← Front Desk</a>
        </header>

        <h1 className="font-bold mb-1" style={{ ...label, fontSize: "1.5rem" }}>Bring your business into STAFFD</h1>
        <p className="text-sm mb-7" style={{ ...muted, lineHeight: 1.6 }}>
          Upload what you already have and your staff will work from it right away.
        </p>

        <ContactsCard onDone={loadSessions} />
        <div className="h-5" />
        <DocumentsCard onDone={loadSessions} />

        <RecentUploads sessions={sessions} />
      </div>
    </main>
  );
}

function ContactsCard({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | null) => {
    setResult(null); setFile(f); setPreview(null);
    if (f) { const text = await f.text(); setPreview(previewRows(text)); }
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const token = pb.authStore.token;
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/upload/contacts", { method: "POST", headers: token ? { Authorization: token } : {}, body: fd });
      setResult(await res.json());
      onDone();
    } catch { setResult({ error: "upload_failed" }); }
    finally { setBusy(false); }
  };

  return (
    <section style={card}>
      <h2 className="font-semibold mb-1" style={{ ...label, fontSize: "1.05rem" }}>Upload your contacts</h2>
      <p className="text-sm mb-4" style={{ ...muted, lineHeight: 1.55 }}>
        A CSV with a <span style={{ color: "#C0C0D8" }}>name</span> column (plus optional email, phone, and notes). Your staff will start working from these right away.
      </p>

      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      <button onClick={() => inputRef.current?.click()} className="text-sm px-4 py-2 rounded-xl font-medium"
        style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E0" }}>
        {file ? `📄 ${file.name}` : "Choose a CSV file"}
      </button>

      {preview && (
        <div className="mt-4">
          <p className="text-xs mb-2" style={faint}>Preview — first {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"}. We&apos;ll match these columns:</p>
          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid #23232E" }}>
            <table className="text-xs w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>{preview.headers.map((h, i) => {
                  const known = KNOWN.includes(h.toLowerCase());
                  return (
                    <th key={i} className="px-2 py-1.5 text-left font-medium"
                      style={{ color: known ? "#7CD992" : "#6A6A80", borderBottom: "1px solid #23232E", whiteSpace: "nowrap" }}>
                      {h}{known ? " ✓" : ""}
                    </th>
                  );
                })}</tr>
              </thead>
              <tbody>
                {preview.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1.5"
                      style={{ color: "#A0A0B8", borderBottom: ri < preview.rows.length - 1 ? "1px solid #1A1A22" : "none", whiteSpace: "nowrap" }}>{c}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: "#7A6A40" }}>
            Heads up: uploading again will create new records — don&apos;t re-upload the same file unless you want duplicates.
          </p>
          <button onClick={() => void submit()} disabled={busy}
            className="mt-3 text-sm px-4 py-2 rounded-xl btn-primary text-white font-semibold disabled:opacity-50">
            {busy ? "Importing…" : "Import contacts"}
          </button>
        </div>
      )}

      <ResultBanner result={result} noun="contact" />
    </section>
  );
}

function DocumentsCard({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true); setResult(null);
    try {
      const token = pb.authStore.token;
      const fd = new FormData(); for (const f of files) fd.append("file", f);
      const res = await fetch("/api/upload/documents", { method: "POST", headers: token ? { Authorization: token } : {}, body: fd });
      setResult(await res.json());
      setFiles([]); onDone();
    } catch { setResult({ error: "upload_failed" }); }
    finally { setBusy(false); }
  };

  return (
    <section style={card}>
      <h2 className="font-semibold mb-1" style={{ ...label, fontSize: "1.05rem" }}>Upload your documents</h2>
      <p className="text-sm mb-4" style={{ ...muted, lineHeight: 1.55 }}>
        Contracts, briefs, notes — PDF, Word, or text files. Your staff will keep them on hand for the work ahead.
      </p>

      <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden"
        onChange={(e) => { setResult(null); setFiles(Array.from(e.target.files ?? [])); }} />
      <button onClick={() => inputRef.current?.click()} className="text-sm px-4 py-2 rounded-xl font-medium"
        style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E0" }}>
        {files.length ? `📎 ${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose files"}
      </button>

      {files.length > 0 && (
        <div className="mt-3">
          <ul className="text-xs space-y-1 mb-3" style={muted}>
            {files.map((f, i) => <li key={i}>• {f.name} <span style={faint}>({Math.round(f.size / 1024)} KB)</span></li>)}
          </ul>
          <button onClick={() => void submit()} disabled={busy}
            className="text-sm px-4 py-2 rounded-xl btn-primary text-white font-semibold disabled:opacity-50">
            {busy ? "Uploading…" : `Upload ${files.length} document${files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      <ResultBanner result={result} noun="document" />
    </section>
  );
}

function ResultBanner({ result, noun }: { result: UploadResult | null; noun: string }) {
  if (!result) return null;
  if ("error" in result) {
    return (
      <p className="text-sm mt-4" style={{ color: "#E08080" }}>
        {result.error === "invalid_csv"
          ? "We couldn't read that file — make sure it has a name column."
          : "Something went wrong with that upload. Give it another try."}
      </p>
    );
  }
  return (
    <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "#0E1A12", border: "1px solid #1F3A28" }}>
      <p className="text-sm font-medium" style={{ color: "#7CD992" }}>
        ✓ {result.succeeded} {noun}{result.succeeded === 1 ? "" : "s"} added{result.failed ? `, ${result.failed} skipped` : ""}.
      </p>
      {result.errors?.length > 0 && (
        <ul className="text-xs mt-2 space-y-0.5" style={faint}>
          {result.errors.slice(0, 5).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
        </ul>
      )}
    </div>
  );
}

function RecentUploads({ sessions }: { sessions: Session[] }) {
  return (
    <section className="mt-8">
      <h3 className="text-xs uppercase tracking-wide mb-3" style={faint}>Recent uploads</h3>
      {sessions.length === 0 ? (
        <p className="text-sm" style={muted}>Nothing uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between text-sm rounded-xl px-4 py-2.5" style={{ background: "#0E0E15", border: "1px solid #1E1E28" }}>
              <span style={{ color: "#C0C0D8" }}>{s.summary ?? `${s.kind} upload`}</span>
              <span style={faint}>{new Date(s.created).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
