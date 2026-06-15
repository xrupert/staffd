"use client";

/**
 * IntegrationsHealthPanel — live status of the self-hosted integrations
 * (Twenty, Chatwoot, Listmonk, Docuseal). Calls the super-admin
 * /api/admin/integrations-health endpoint, which runs read-only auth probes
 * against each service. One-click "test to confirm" for the operator.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type Status = "not_configured" | "ok" | "auth_failed" | "error" | "unreachable" | "loading";

const SERVICES: { key: string; label: string; note: string }[] = [
  { key: "twenty", label: "Twenty CRM", note: "Sales pipeline + contacts" },
  { key: "chatwoot", label: "Chatwoot", note: "Support tickets" },
  { key: "listmonk", label: "Listmonk", note: "Email campaigns" },
  { key: "docuseal", label: "Docuseal", note: "E-signatures" },
];

const STATUS_META: Record<Status, { color: string; bg: string; border: string; text: string }> = {
  ok:             { color: "#22C55E", bg: "rgba(34,197,94,0.1)",  border: "rgba(34,197,94,0.3)",  text: "Connected" },
  auth_failed:    { color: "#EF4444", bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.3)",  text: "Auth failed" },
  error:          { color: "#F59E0B", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "Misconfigured" },
  unreachable:    { color: "#F59E0B", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "Unreachable" },
  not_configured: { color: "#5A5A70", bg: "rgba(90,90,112,0.1)",  border: "#2A2A38",              text: "Not configured" },
  loading:        { color: "#7070A0", bg: "transparent",          border: "#2A2A38",              text: "Checking…" },
};

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

export default function IntegrationsHealthPanel() {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatuses({ twenty: "loading", chatwoot: "loading", listmonk: "loading", docuseal: "loading" });
    try {
      const token = pb.authStore.token;
      const res = await fetch(`/api/admin/integrations-health?pbToken=${encodeURIComponent(token)}`);
      if (!res.ok) {
        setError(res.status === 403 || res.status === 401 ? "Super-admin only." : "Health check failed.");
        setStatuses({});
        return;
      }
      const data = (await res.json()) as { integrations: Record<string, Status> };
      setStatuses(data.integrations ?? {});
    } catch {
      setError("Couldn't reach the health endpoint.");
      setStatuses({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
          Integrations Health
        </h2>
        <button
          onClick={() => void check()}
          disabled={loading}
          className="text-xs transition-colors hover:text-white"
          style={{ color: "#A07BFF", background: "none", border: "none", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl text-xs mb-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}>
          {error}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {SERVICES.map((svc) => {
          const status: Status = statuses[svc.key] ?? "loading";
          const meta = STATUS_META[status];
          return (
            <div key={svc.key} style={cardStyle}>
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold text-sm" style={{ color: "#F0F0F8" }}>{svc.label}</p>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                  {meta.text}
                </span>
              </div>
              <p className="text-xs" style={{ color: "#5A5A70" }}>{svc.note}</p>
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-3" style={{ color: "#5A5A70" }}>
        Read-only auth probes — no records are created. &quot;Not configured&quot; means the service&apos;s env vars are unset.
      </p>
    </section>
  );
}
