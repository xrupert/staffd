"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const ADMIN_EMAIL = "chris.rupert@cybridagency.com";

interface Business {
  id: string;
  user: string;
  business_name: string;
  industry: string;
  focus: string;
  situation: string;
  website: string;
  created: string;
  updated: string;
  expand?: {
    user?: {
      id: string;
      email: string;
      name: string;
    };
  };
}

interface DocStats {
  userId: string;
  count: number;
  lastActive: string;
  departments: string[];
}

interface AdminData {
  businesses: Business[];
  docStats: DocStats[];
  totalDocs: number;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"clients" | "usage">("clients");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/data");
      if (res.status === 403) {
        setError("Access denied.");
        return;
      }
      if (!res.ok) throw new Error("Failed to load admin data");
      const json = (await res.json()) as AdminData;
      setData(json);
    } catch {
      setError("Failed to load. Check console.");
    } finally {
      setLoading(false);
    }
  }

  function daysSince(dateStr: string): number {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  }

  function isCold(business: Business): boolean {
    const stats = data?.docStats.find((s) => s.userId === business.user);
    const lastActivity = stats?.lastActive ?? business.updated;
    return daysSince(lastActivity) > 7;
  }

  const filtered = (data?.businesses ?? []).filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.business_name?.toLowerCase().includes(q) ||
      b.industry?.toLowerCase().includes(q) ||
      b.expand?.user?.email?.toLowerCase().includes(q)
    );
  });

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "#09090F" }}>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(91,33,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(91,33,232,0.03) 1px,transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <a href="/dashboard">
              <Image src="/logo-light.png" alt="STAFFD" width={80} height={36} style={{ objectFit: "contain" }} />
            </a>
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-widest"
              style={{ background: "rgba(91,33,232,0.2)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.3)" }}
            >
              Admin
            </span>
          </div>
          <span className="text-xs" style={{ color: "#3A3A55" }}>{ADMIN_EMAIL}</span>
        </header>

        {error && (
          <div
            className="px-5 py-4 rounded-xl text-sm mb-8"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#EF4444" }}
          >
            {error}
          </div>
        )}

        {loading && !error && (
          <div className="flex items-center gap-3 py-12" style={{ color: "#3A3A55" }}>
            <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
            <span className="text-sm">Loading...</span>
          </div>
        )}

        {data && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Total clients", value: data.businesses.length },
                { label: "Total documents", value: data.totalDocs },
                { label: "Cold (7+ days)", value: data.businesses.filter(isCold).length },
                { label: "Active today", value: data.docStats.filter((s) => daysSince(s.lastActive) === 0).length },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl px-5 py-4"
                  style={{ background: "#111118", border: "1px solid #2A2A38" }}
                >
                  <p className="text-2xl font-bold mb-1" style={{ color: "#F0F0F8" }}>{stat.value}</p>
                  <p className="text-xs" style={{ color: "#5A5A70" }}>{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Tab + search row */}
            <div className="flex items-center justify-between mb-5 gap-4">
              <div className="flex gap-1 rounded-xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38", padding: "3px" }}>
                {(["clients", "usage"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all"
                    style={{
                      background: tab === t ? "rgba(91,33,232,0.2)" : "transparent",
                      color: tab === t ? "#A07BFF" : "#5A5A70",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, industry, email…"
                className="flex-1 max-w-xs px-4 py-2 rounded-xl text-xs outline-none"
                style={{ background: "#111118", border: "1px solid #2A2A38", color: "#F0F0F8" }}
              />
            </div>

            {/* Clients tab */}
            {tab === "clients" && (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2A2A38" }}>
                      {["Business", "Industry", "Email", "Focus", "Joined", "Last active", "Status"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 font-semibold" style={{ color: "#5A5A70" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center px-4 py-8" style={{ color: "#3A3A55" }}>
                          No clients found.
                        </td>
                      </tr>
                    )}
                    {filtered.map((b) => {
                      const stats = data.docStats.find((s) => s.userId === b.user);
                      const lastActivity = stats?.lastActive ?? b.updated;
                      const days = daysSince(lastActivity);
                      const cold = days > 7;
                      return (
                        <tr
                          key={b.id}
                          style={{ borderBottom: "1px solid #1E1E2A" }}
                        >
                          <td className="px-4 py-3 font-medium" style={{ color: "#F0F0F8" }}>
                            {b.business_name || <span style={{ color: "#3A3A55" }}>—</span>}
                          </td>
                          <td className="px-4 py-3" style={{ color: "#9090A8" }}>
                            {b.industry || <span style={{ color: "#3A3A55" }}>—</span>}
                          </td>
                          <td className="px-4 py-3" style={{ color: "#6060A0" }}>
                            {b.expand?.user?.email ?? "—"}
                          </td>
                          <td className="px-4 py-3" style={{ color: "#9090A8" }}>
                            {b.focus || "—"}
                          </td>
                          <td className="px-4 py-3" style={{ color: "#5A5A70" }}>
                            {new Date(b.created).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3" style={{ color: cold ? "#F59E0B" : "#5A5A70" }}>
                            {days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{
                                background: cold ? "rgba(245,158,11,0.1)" : "rgba(34,197,94,0.1)",
                                color: cold ? "#F59E0B" : "#22C55E",
                              }}
                            >
                              {cold ? "Cold" : "Active"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Usage tab */}
            {tab === "usage" && (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2A2A38" }}>
                      {["Business", "Documents", "Departments used", "Last active"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 font-semibold" style={{ color: "#5A5A70" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center px-4 py-8" style={{ color: "#3A3A55" }}>
                          No data found.
                        </td>
                      </tr>
                    )}
                    {[...filtered]
                      .sort((a, b) => {
                        const sa = data.docStats.find((s) => s.userId === a.user)?.count ?? 0;
                        const sb = data.docStats.find((s) => s.userId === b.user)?.count ?? 0;
                        return sb - sa;
                      })
                      .map((b) => {
                        const stats = data.docStats.find((s) => s.userId === b.user);
                        return (
                          <tr key={b.id} style={{ borderBottom: "1px solid #1E1E2A" }}>
                            <td className="px-4 py-3 font-medium" style={{ color: "#F0F0F8" }}>
                              {b.business_name || b.expand?.user?.email || "—"}
                            </td>
                            <td className="px-4 py-3" style={{ color: "#A07BFF" }}>
                              {stats?.count ?? 0}
                            </td>
                            <td className="px-4 py-3" style={{ color: "#9090A8" }}>
                              {stats?.departments.length
                                ? stats.departments.slice(0, 4).join(", ") + (stats.departments.length > 4 ? ` +${stats.departments.length - 4}` : "")
                                : <span style={{ color: "#3A3A55" }}>None yet</span>}
                            </td>
                            <td className="px-4 py-3" style={{ color: "#5A5A70" }}>
                              {stats?.lastActive
                                ? new Date(stats.lastActive).toLocaleDateString()
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
