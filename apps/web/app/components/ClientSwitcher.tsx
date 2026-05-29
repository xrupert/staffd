"use client";

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

interface Client {
  id: string;
  name: string;
  industry?: string;
  status?: string;
}

interface ClientSwitcherProps {
  /** Called whenever the active client changes (or is cleared). */
  onChange?: (clientId: string | null) => void;
}

const STORAGE_KEY = "staffd_active_client";

/**
 * Compact dropdown shown in the agency dashboard header.
 * Lets the agency user pick which client they're working as.
 * The choice is persisted to localStorage so it survives page changes.
 */
export default function ClientSwitcher({ onChange }: ClientSwitcherProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const userId = pb.authStore.record?.id ?? "";
      if (!userId) return;

      const res = await fetch(`/api/clients?userId=${userId}`);
      if (res.status === 403) {
        setAllowed(false);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { clients: Client[] };
      setAllowed(true);
      const activeClients = (data.clients ?? []).filter((c) => c.status !== "archived");
      setClients(activeClients);

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && activeClients.some((c) => c.id === stored)) {
        setActiveId(stored);
        onChange?.(stored);
      } else if (stored) {
        // Stale — client no longer exists
        localStorage.removeItem(STORAGE_KEY);
        onChange?.(null);
      }
    } catch { /* proceed */ }
  }

  function select(clientId: string | null) {
    if (clientId) localStorage.setItem(STORAGE_KEY, clientId);
    else localStorage.removeItem(STORAGE_KEY);
    setActiveId(clientId);
    setOpen(false);
    onChange?.(clientId);
    // Reload so any pages reading the active client refresh their context
    if (typeof window !== "undefined") window.location.reload();
  }

  if (!allowed) return null;

  const active = clients.find((c) => c.id === activeId) ?? null;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
        style={{
          background: active ? "rgba(91,33,232,0.15)" : "rgba(255,255,255,0.04)",
          border: active ? "1px solid rgba(91,33,232,0.35)" : "1px solid #2A2A38",
          color: active ? "#A07BFF" : "#9090A8",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: "12px" }}>👤</span>
        <span style={{ maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {active ? active.name : "Agency view"}
        </span>
        <span style={{ fontSize: "9px", opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 50,
              width: "260px",
              background: "#111118",
              border: "1px solid #2A2A38",
              borderRadius: "12px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #1E1E2A" }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5B21E8" }}>
                Acting as
              </p>
            </div>

            <button
              onClick={() => select(null)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                background: !activeId ? "rgba(91,33,232,0.08)" : "transparent",
                border: "none",
                cursor: "pointer",
                borderBottom: "1px solid #1E1E2A",
              }}
            >
              <p className="text-xs font-semibold" style={{ color: !activeId ? "#A07BFF" : "#F0F0F8" }}>
                Agency view {!activeId && "✓"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>Cross-client overview</p>
            </button>

            <div style={{ maxHeight: "280px", overflowY: "auto" }}>
              {clients.length === 0 ? (
                <div style={{ padding: "16px 14px", textAlign: "center" }}>
                  <p className="text-xs" style={{ color: "#5A5A70" }}>No clients yet.</p>
                </div>
              ) : (
                clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => select(c.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 14px",
                      background: activeId === c.id ? "rgba(91,33,232,0.08)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      borderBottom: "1px solid #1E1E2A",
                    }}
                  >
                    <p className="text-xs font-semibold" style={{ color: activeId === c.id ? "#A07BFF" : "#F0F0F8" }}>
                      {c.name} {activeId === c.id && "✓"}
                    </p>
                    {c.industry && (
                      <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>{c.industry}</p>
                    )}
                  </button>
                ))
              )}
            </div>

            <a
              href="/dashboard/clients"
              style={{
                display: "block",
                padding: "10px 14px",
                textAlign: "center",
                color: "#A07BFF",
                fontSize: "11px",
                fontWeight: 600,
                textDecoration: "none",
                borderTop: "1px solid #1E1E2A",
              }}
            >
              + Manage clients →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
