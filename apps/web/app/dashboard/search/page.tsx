"use client";

/**
 * /dashboard/search — Smart Search (MX-4).
 *
 * Semantic search across everything the user's staff has produced, powered
 * by the Living Vault retrieval API (POST /api/vault/search). This is the
 * surface for the "Smart Search across all your team's work" the pricing
 * page sells. Document hits link straight to the doc; conversation hits
 * show as context.
 */

import { useState } from "react";
import Image from "next/image";
import pb from "../../../lib/pb";

type SearchResult = {
  sourceId: string;
  sourceKind: "document" | "conversation";
  dept: string | null;
  summary: string;
  score: number;
};

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", design: "Design",
  "paid-media": "Paid Media", reputation: "Reputation", ceo: "The CEO",
};

export default function SmartSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [error, setError] = useState("");

  async function runSearch() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError("");
    setDegraded(false);
    try {
      const res = await fetch("/api/vault/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pbToken: pb.authStore.token, query: q }),
      });
      if (!res.ok) {
        setError("Search is unavailable right now. Try again in a moment.");
        setResults([]);
        return;
      }
      const data = (await res.json()) as { results: SearchResult[]; degraded?: boolean };
      setResults(data.results ?? []);
      setDegraded(!!data.degraded);
    } catch {
      setError("Search is unavailable right now. Try again in a moment.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard">
            <Image src="/logo-light.png" alt="STAFFD" width={90} height={40} style={{ objectFit: "contain" }} />
          </a>
          <a href="/dashboard/library" className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>
            Library →
          </a>
        </header>

        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5B21E8" }}>
            Smart Search
          </p>
          <h1 className="font-bold mb-2" style={{ color: "#F0F0F8", fontSize: "1.75rem", letterSpacing: "-0.02em" }}>
            Find anything your staff has produced.
          </h1>
          <p className="text-sm" style={{ color: "#7070A0", lineHeight: 1.6 }}>
            Search by meaning, not just keywords — across every document, brief, and conversation in your Vault.
          </p>
        </div>

        {/* Search box */}
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
            placeholder="e.g. that proposal for the dental client, or Q3 campaign ideas…"
            className="flex-1 px-4 py-3 rounded-xl text-sm outline-none"
            style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
            autoFocus
          />
          <button
            onClick={() => void runSearch()}
            disabled={!query.trim() || loading}
            className="btn-primary px-5 py-3 rounded-xl text-sm font-semibold text-white flex-shrink-0"
            style={{ opacity: !query.trim() || loading ? 0.4 : 1, cursor: !query.trim() || loading ? "not-allowed" : "pointer" }}
          >
            {loading ? "Searching…" : "Search →"}
          </button>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-xl text-xs mb-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
            {error}
          </div>
        )}

        {degraded && (
          <div className="px-4 py-3 rounded-xl text-xs mb-4" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#F59E0B" }}>
            Search is still warming up on your Vault — results may be incomplete. Generate a bit more work and try again.
          </div>
        )}

        {/* Results */}
        {results !== null && !loading && (
          results.length === 0 && !degraded ? (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: "#5A5A70" }}>
                No matches found. Try different words — Smart Search looks for meaning, so describe what the work was about.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {results.map((r, i) => {
                const deptLabel = r.dept ? (DEPT_LABELS[r.dept] ?? r.dept) : null;
                const isDoc = r.sourceKind === "document";
                const inner = (
                  <div
                    className="rounded-2xl p-5 transition-transform"
                    style={{ background: "#111118", border: "1px solid #2A2A38" }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {deptLabel && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(91,33,232,0.12)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.2)" }}>
                          {deptLabel}
                        </span>
                      )}
                      <span className="text-xs" style={{ color: "#5A5A70" }}>
                        {isDoc ? "Document" : "Conversation"}
                      </span>
                      <span className="ml-auto text-xs" style={{ color: "#3A3A55" }}>
                        {Math.round(r.score * 100)}% match
                      </span>
                    </div>
                    <p className="text-sm" style={{ color: "#D0D0E8", lineHeight: 1.6 }}>
                      {r.summary || "(no summary)"}
                    </p>
                    {isDoc && (
                      <p className="text-xs mt-2" style={{ color: "#A07BFF" }}>Open document →</p>
                    )}
                  </div>
                );
                return isDoc ? (
                  <a key={`${r.sourceId}-${i}`} href={`/doc/${r.sourceId}`} className="block hover:-translate-y-px" style={{ textDecoration: "none" }}>
                    {inner}
                  </a>
                ) : (
                  <div key={`${r.sourceId}-${i}`}>{inner}</div>
                );
              })}
            </div>
          )
        )}

        {results === null && !loading && (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "#3A3A55" }}>
              Your whole Vault, one search away.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
