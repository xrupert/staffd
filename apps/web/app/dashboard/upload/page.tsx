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

type DocItem = { document_id: string; name: string; status: "extracted" | "extraction_pending" };
type UploadResult =
  | { ok: boolean; total: number; succeeded: number; failed: number; errors: { row: number; reason: string }[]; documents?: DocItem[] }
  | { error: string; detail?: string };
type Session = { id: string; kind: string; summary?: string; succeeded?: number; failed?: number; created: string };
type DocStatus = { name: string; state: "processing" | "ready" | "error" | "slow"; preview?: string };

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

// Documents now upload DIRECTLY to PocketBase (the browser's own session, the
// same pattern already used by the Vault logo upload) — the Vercel 4.5MB body
// cap no longer applies, since file bytes never pass through a Vercel
// function. These are our actual intended limits (PocketBase enforces the
// same at the field level as defense-in-depth).
const MAX_DOC_BYTES = 25 * 1024 * 1024;       // 25 MB / file
const MAX_SESSION_BYTES = 100 * 1024 * 1024;  // 100 MB / batch
const TEXT_EXT = new Set(["txt", "md"]);
const BINARY_EXT = new Set(["pdf", "docx"]);

function DocumentsCard({ onDone }: { onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [statuses, setStatuses] = useState<Record<string, DocStatus>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Poll a pending document until extraction finishes. The drain runs on a
  // ~60s cron, so a 30s window gave up before the work could even start (it
  // looked permanently stuck). Poll for ~3 minutes — comfortably past one cron
  // cycle plus extraction — and if it's still going, leave an honest "still
  // working" note rather than an endless spinner (a reload re-reads the truth).
  const pollDoc = useCallback(async (id: string, name: string) => {
    const token = pb.authStore.token;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      try {
        const res = await fetch(`/api/documents/${id}`, { headers: token ? { Authorization: token } : {} });
        if (!res.ok) continue;
        const d = await res.json() as { extraction_status?: string; preview?: string };
        if (d.extraction_status === "extracted") { setStatuses((s) => ({ ...s, [id]: { name, state: "ready", preview: d.preview } })); return; }
        if (d.extraction_status === "error") { setStatuses((s) => ({ ...s, [id]: { name, state: "error" } })); return; }
      } catch { /* keep polling */ }
    }
    setStatuses((s) => ({ ...s, [id]: { name, state: "slow" } }));
  }, []);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const oversizedFiles = files.filter((f) => f.size > MAX_DOC_BYTES);
  const tooLargeToSend = oversizedFiles.length > 0 || totalBytes > MAX_SESSION_BYTES;

  const submit = async () => {
    if (files.length === 0 || tooLargeToSend) return;
    setBusy(true); setResult(null); setStatuses({});
    const clientErrors: { row: number; reason: string }[] = [];
    // Carries the ORIGINAL file-selection row so a later finalize error can be
    // attributed to the right row, not a fabricated 1..N re-index (review fix —
    // a re-derived index collided across create-failures and finalize-failures
    // in the same batch, mislabeling which file actually failed).
    const createdIds: { id: string; name: string; row: number }[] = [];

    let idx = 0;
    for (const file of files) {
      idx++;
      const e = file.name.toLowerCase().split(".").pop() ?? "";
      if (!TEXT_EXT.has(e) && !BINARY_EXT.has(e)) {
        clientErrors.push({ row: idx, reason: `unsupported type ".${e}" (allowed: PDF, DOCX, TXT, MD)` });
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("user", pb.authStore.record?.id ?? "");
        fd.append("client", "");
        fd.append("department", "library");
        fd.append("agent_name", "Uploaded document");
        fd.append("prompt", file.name);
        fd.append("source", "upload");
        fd.append("extraction_status", "pending"); // finalize decides the real outcome
        fd.append("output", "[Reading this document… your specialist will have it shortly.]");
        fd.append("file", file, file.name);
        // Direct to PocketBase — no Vercel function in the file path, so the
        // platform's ~4.5MB body cap never applies (only our own 25MB limit,
        // already gated client-side and enforced at the PB field level).
        const rec = await pb.collection("documents").create(fd);
        createdIds.push({ id: (rec as { id: string }).id, name: file.name, row: idx });
      } catch (e) {
        clientErrors.push({ row: idx, reason: e instanceof Error ? e.message : "upload_failed" });
      }
    }

    if (createdIds.length === 0) {
      setResult({ error: clientErrors[0]?.reason ?? "upload_failed" });
      setBusy(false);
      return;
    }

    try {
      const token = pb.authStore.token;
      const finRes = await fetch("/api/upload/documents/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
        body: JSON.stringify({ documentIds: createdIds.map((d) => d.id) }),
      });
      const finData = await finRes.json().catch(() => null) as
        | { ok: boolean; total: number; succeeded: number; failed: number; results: { document_id: string; name: string; status: "extracted" | "extraction_pending" }[]; errors: { document_id: string; reason: string }[] }
        | null;

      if (!finRes.ok || !finData) {
        setResult({ error: "upload_failed", detail: `finalize status ${finRes.status}` });
      } else {
        // finalize's `name` is doc.file — PocketBase's STORED filename (it
        // sanitizes + appends a random suffix on create), correct for building
        // fetch URLs but not for display. Prefer the clean original name the
        // user actually selected, already on hand in createdIds (review fix).
        const documents = finData.results.map((r) => ({
          document_id: r.document_id,
          name: createdIds.find((c) => c.id === r.document_id)?.name ?? r.name,
          status: r.status,
        }));
        // Look up the ORIGINAL row by document_id — finalize errors are keyed
        // by id, not position, and re-deriving an index here would collide
        // with clientErrors' real row numbers (review fix).
        const allErrors = [
          ...clientErrors,
          ...finData.errors.map((e) => ({ row: createdIds.find((c) => c.id === e.document_id)?.row ?? -1, reason: e.reason })),
        ];
        setResult({ ok: true, total: files.length, succeeded: finData.succeeded, failed: clientErrors.length + finData.failed, errors: allErrors, documents });
        const init: Record<string, DocStatus> = {};
        for (const d of documents) init[d.document_id] = { name: d.name, state: d.status === "extracted" ? "ready" : "processing" };
        setStatuses(init);
        for (const d of documents) if (d.status === "extraction_pending") void pollDoc(d.document_id, d.name);
      }
    } catch {
      setResult({ error: "upload_failed", detail: "finalize unreachable" });
    }

    setFiles([]); onDone();
    setBusy(false);
  };

  const statusList = Object.entries(statuses);

  return (
    <section style={card}>
      <h2 className="font-semibold mb-1" style={{ ...label, fontSize: "1.05rem" }}>Upload your documents</h2>
      <p className="text-sm mb-4" style={{ ...muted, lineHeight: 1.55 }}>
        Contracts, briefs, notes — PDF, Word, or text files. Your staff will read them and keep them on hand for the work ahead.
      </p>

      <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.txt,.md" className="hidden"
        onChange={(e) => { setResult(null); setStatuses({}); setFiles(Array.from(e.target.files ?? [])); }} />
      <button onClick={() => inputRef.current?.click()} className="text-sm px-4 py-2 rounded-xl font-medium"
        style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E0" }}>
        {files.length ? `📎 ${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose files"}
      </button>

      {files.length > 0 && (
        <div className="mt-3">
          <ul className="text-xs space-y-1 mb-3" style={muted}>
            {files.map((f, i) => (
              <li key={i}>
                • {f.name}{" "}
                <span style={f.size > MAX_DOC_BYTES ? { color: "#E0B060" } : faint}>
                  ({Math.round(f.size / 1024)} KB{f.size > MAX_DOC_BYTES ? " — too large" : ""})
                </span>
              </li>
            ))}
          </ul>
          {tooLargeToSend && (
            <p className="text-xs mb-3" style={{ color: "#E0B060" }}>
              {oversizedFiles.length > 0
                ? `${oversizedFiles.length === 1 ? "That file is" : "Those files are"} too large to upload — keep each file under ${Math.round(MAX_DOC_BYTES / (1024 * 1024))}MB.`
                : `These files total more than ${Math.round(MAX_SESSION_BYTES / (1024 * 1024))}MB — upload them in smaller batches.`}
            </p>
          )}
          <button onClick={() => void submit()} disabled={busy || tooLargeToSend}
            className="text-sm px-4 py-2 rounded-xl btn-primary text-white font-semibold disabled:opacity-50">
            {busy ? "Uploading…" : `Upload ${files.length} document${files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {statusList.length > 0 && (
        <ul className="mt-4 space-y-2">
          {statusList.map(([id, s]) => (
            <li key={id} className="text-sm rounded-lg px-3 py-2" style={{ background: "#0E0E15", border: "1px solid #1E1E28" }}>
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: "#C0C0D8" }} className="truncate">{s.name}</span>
                <span className="text-xs shrink-0" style={{ color: s.state === "ready" ? "#7CD992" : s.state === "error" ? "#E0B060" : "#8A8AA0" }}>
                  {s.state === "ready" ? "✓ Ready" : s.state === "error" ? "Couldn't read" : s.state === "slow" ? "Still working — reload to check" : "Processing…"}
                </span>
              </div>
              {s.state === "ready" && s.preview && <p className="text-xs mt-1" style={faint}>{s.preview}{s.preview.length >= 200 ? "…" : ""}</p>}
              {s.state === "error" && <p className="text-xs mt-1" style={faint}>We couldn&apos;t read this file — your specialist can still work from the file name and your description.</p>}
            </li>
          ))}
        </ul>
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
          : result.error === "too_large" || result.error === "session_too_large"
          ? "That upload was too large. Try fewer or smaller files at a time."
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
