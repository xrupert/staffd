"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { exportToDocx } from "../../components/DocExport";

interface DocData {
  id: string;
  department: string;
  agent_name: string;
  prompt: string;
  output: string;
  created: string;
  businessName: string;
  logoUrl: string;
}

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  ceo: "Strategy",
  "paid-media": "Paid Media",
  design: "Design",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function DocViewPage() {
  const params = useParams();
  const id = params?.id as string;

  const [doc, setDoc] = useState<DocData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function load() {
    try {
      const res = await fetch(`/api/doc/${id}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const data = (await res.json()) as DocData;
      setDoc(data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  async function copyText() {
    if (!doc) return;
    await navigator.clipboard.writeText(doc.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <main style={{ background: "#09090F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#5A5A70" }}>
          <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#5B21E8", animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: "14px" }}>Loading document…</span>
        </div>
      </main>
    );
  }

  if (notFound || !doc) {
    return (
      <main style={{ background: "#09090F", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#5A5A70", fontSize: "14px", marginBottom: "8px" }}>This document could not be found.</p>
          <p style={{ color: "#3A3A50", fontSize: "12px" }}>The link may have expired or the document may have been deleted.</p>
        </div>
      </main>
    );
  }

  return (
    <>
      {/* Print-only header */}
      <div className="print-only print-header">
        {doc.logoUrl && <img src={doc.logoUrl} alt={doc.businessName} className="print-logo" />}
        {doc.businessName && !doc.logoUrl && <span className="print-biz-name">{doc.businessName}</span>}
        <div className="print-divider" />
      </div>

      <main
        className="no-print-chrome"
        style={{ background: "#09090F", minHeight: "100vh" }}
      >
        {/* Subtle grid bg */}
        <div
          className="no-print"
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />

        <div style={{ position: "relative", zIndex: 10, maxWidth: "760px", margin: "0 auto", padding: "40px 24px 80px" }}>

          {/* Minimal top bar */}
          <div
            className="no-print"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "40px",
            }}
          >
            {/* Brand mark */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "8px",
                  background: "rgba(91,33,232,0.2)",
                  border: "1px solid rgba(91,33,232,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: "12px" }}>✦</span>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#5A5A70", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                STAFFD
              </span>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <button
                onClick={() => void copyText()}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: copied ? "#22C55E" : "#5A5A70",
                  transition: "color 0.2s",
                  padding: 0,
                }}
              >
                {copied ? "Copied ✓" : "Copy text"}
              </button>
              <button
                onClick={() => window.print()}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "#5A5A70",
                  transition: "color 0.2s",
                  padding: 0,
                }}
              >
                Save PDF
              </button>
              <button
                onClick={() => void exportToDocx(doc.output, doc.businessName || undefined)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "#5A5A70",
                  transition: "color 0.2s",
                  padding: 0,
                }}
              >
                Download .docx
              </button>
            </div>
          </div>

          {/* Document card */}
          <div
            style={{
              background: "#111118",
              border: "1px solid #2A2A38",
              borderRadius: "20px",
              overflow: "hidden",
            }}
          >
            {/* Doc header */}
            <div
              style={{
                padding: "28px 32px 24px",
                borderBottom: "1px solid #1E1E2A",
              }}
            >
              {/* Business name / logo */}
              {(doc.businessName || doc.logoUrl) && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
                  {doc.logoUrl ? (
                    <img
                      src={doc.logoUrl}
                      alt={doc.businessName}
                      style={{ height: "28px", maxWidth: "120px", objectFit: "contain" }}
                    />
                  ) : (
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#9090A8" }}>
                      {doc.businessName}
                    </span>
                  )}
                </div>
              )}

              {/* Meta row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    padding: "3px 10px",
                    borderRadius: "100px",
                    background: "rgba(91,33,232,0.15)",
                    color: "#8060D0",
                    border: "1px solid rgba(91,33,232,0.25)",
                  }}
                >
                  {DEPT_LABELS[doc.department] ?? doc.department}
                </span>
                {doc.agent_name && (
                  <span style={{ fontSize: "11px", color: "#4A4A65" }}>
                    {doc.agent_name}
                  </span>
                )}
                <span style={{ fontSize: "11px", color: "#3A3A50", marginLeft: "auto" }}>
                  {formatDate(doc.created)}
                </span>
              </div>

              {/* Prompt / title */}
              <p
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#D0D0E8",
                  lineHeight: 1.4,
                  margin: 0,
                }}
              >
                {doc.prompt}
              </p>
            </div>

            {/* Document output */}
            <div className="agent-output" style={{ padding: "28px 32px" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.output}</ReactMarkdown>
            </div>
          </div>

          {/* Footer */}
          <div
            className="no-print"
            style={{
              marginTop: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <span style={{ fontSize: "11px", color: "#2E2E45" }}>Generated by</span>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#3A3A55", letterSpacing: "0.08em" }}>STAFFD</span>
          </div>
        </div>
      </main>
    </>
  );
}
