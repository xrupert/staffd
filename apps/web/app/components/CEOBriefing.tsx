"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";
import { anchorTopIfBelowViewport } from "../../lib/scroll";

export default function CEOBriefing() {
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  async function generate() {
    if (loading) return;
    setOutput("");
    setLoading(true);

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken }),
      });

      if (!res.ok) throw new Error("Failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");

      let result = "";
      // W68 — single anchor at stream start; no auto-follow after.
      setTimeout(() => anchorTopIfBelowViewport(outputRef.current), 50);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        setOutput(result);
      }
    } catch {
      setOutput("Unable to generate briefing. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyBriefing() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-7 no-print">
      <div
        style={{
          background: "rgba(91,33,232,0.05)",
          border: "1px solid rgba(91,33,232,0.18)",
          borderRadius: "16px",
          overflow: "hidden",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "9px",
                background: "rgba(91,33,232,0.15)",
                border: "1px solid rgba(91,33,232,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
              }}
            >
              📋
            </div>
            <div>
              <p
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#6040B0",
                  margin: 0,
                  marginBottom: "2px",
                }}
              >
                Weekly Briefing
              </p>
              <p style={{ fontSize: "12px", color: "#4A4A65", margin: 0 }}>
                {today}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {output && !loading && (
              <button
                onClick={() => void copyBriefing()}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "11px",
                  color: copied ? "#22C55E" : "#7A7A95",
                  padding: 0,
                  transition: "color 0.2s",
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
            <button
              onClick={() => void generate()}
              disabled={loading}
              style={{
                background: loading
                  ? "rgba(91,33,232,0.08)"
                  : "rgba(91,33,232,0.18)",
                border: "1px solid rgba(91,33,232,0.35)",
                borderRadius: "10px",
                padding: "7px 16px",
                fontSize: "12px",
                fontWeight: 600,
                color: loading ? "#6040B0" : "#A07BFF",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s",
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#5B21E8",
                      animation: "pulse-soft 1.4s ease-in-out infinite",
                    }}
                  />
                  Drafting…
                </>
              ) : output ? (
                "Refresh"
              ) : (
                "Generate Briefing →"
              )}
            </button>
          </div>
        </div>

        {/* Empty state */}
        {!output && !loading && (
          <div
            style={{
              borderTop: "1px solid rgba(91,33,232,0.1)",
              padding: "14px 20px",
            }}
          >
            <p style={{ fontSize: "12px", color: "#3A3A55", margin: 0 }}>
              Your situation, top priority, staff activity, and what to focus on next — synthesized from your vault and your team&apos;s recent work.
            </p>
          </div>
        )}

        {/* Output — PR-UX-2: the briefing renders as a document ceremony
            (letterhead, sections revealing as they stream, a signed close),
            not a chat reply. */}
        {(output || loading) && (
          <div
            ref={outputRef}
            style={{
              borderTop: "1px solid rgba(91,33,232,0.12)",
              padding: "20px 24px",
              background: "linear-gradient(180deg, rgba(91,33,232,0.04) 0%, rgba(13,13,22,0) 120px)",
            }}
          >
            {/* Letterhead */}
            <div className="anim-rise" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "2px solid rgba(91,33,232,0.35)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#A07BFF" }}>
                  Memorandum — The CEO
                </span>
                <span style={{ fontSize: 11, color: "#7A7A95", whiteSpace: "nowrap" }}>{today}</span>
              </div>
            </div>

            {loading && !output ? (
              <div className="flex flex-col gap-2.5" aria-label="Preparing your briefing">
                <p className="anim-pulse-soft" style={{ fontSize: "12px", color: "#A07BFF", margin: 0 }}>
                  Reviewing your staff&apos;s work across every department…
                </p>
                <div className="skeleton" style={{ height: 12, width: "55%" }} />
                <div className="skeleton" style={{ height: 10, width: "100%" }} />
                <div className="skeleton" style={{ height: 10, width: "92%" }} />
                <div className="skeleton" style={{ height: 10, width: "70%" }} />
              </div>
            ) : (
              <div
                className="agent-output"
                style={{ fontSize: "13px", lineHeight: "1.75" }}
              >
                {/* Sections reveal one at a time as the stream crosses each
                    heading boundary (keyed by index — stable across updates). */}
                {output.split(/\n(?=## )/).map((section, i) => (
                  <div key={i} className="anim-rise" style={{ animationDelay: `${Math.min(i, 4) * 90}ms` }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{section}</ReactMarkdown>
                  </div>
                ))}
                {loading && (
                  <span
                    style={{
                      display: "inline-block",
                      width: "2px",
                      height: "13px",
                      background: "#5B21E8",
                      animation: "pulse-soft 1.4s ease-in-out infinite",
                      verticalAlign: "middle",
                      marginLeft: "2px",
                    }}
                  />
                )}
                {!loading && output && (
                  <p className="anim-rise" style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid rgba(91,33,232,0.18)", fontSize: 12, fontStyle: "italic", color: "#A07BFF" }}>
                    — The CEO · on behalf of your staff
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
