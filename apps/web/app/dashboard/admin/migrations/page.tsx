"use client";

/**
 * /dashboard/admin/migrations — in-app PB migration trigger (W95.3.4).
 *
 * Super-admin gated by the parent /dashboard/admin layout. Lists the migration
 * registry with live exists/missing status and runs each via button — the
 * operator never touches a shell for routine setup (Standard #17). Each run
 * POSTs to /api/setup/<route> with the super-admin session (dual-auth proxy)
 * and records an admin_migration_log audit row.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../../../lib/pb";

type Migration = {
  route: string;
  label: string;
  collection: string;
  bootstrap: boolean;
  note: string | null;
  status: "exists" | "missing" | "unknown";
  lastRun: { ran_at: string; result: string } | null;
};

const statusColor: Record<string, string> = { exists: "#7CD992", missing: "#E0B060", unknown: "#7A7A90" };
const statusLabel: Record<string, string> = { exists: "Created", missing: "Missing", unknown: "Unknown" };

export default function MigrationsPage() {
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/migrations?pbToken=${encodeURIComponent(pb.authStore.token)}`);
      if (!res.ok) { setError(res.status === 403 ? "Super-admin only." : "Couldn't load migrations."); return; }
      setError("");
      setMigrations(((await res.json()).migrations as Migration[]) ?? []);
    } catch { setError("Couldn't load migrations."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const runOne = useCallback(async (m: Migration): Promise<string> => {
    if (m.bootstrap) return "bootstrap (CLI only)";
    setRunning(m.route);
    const token = pb.authStore.token;
    const start = Date.now();
    let resultStr = "error";
    let body = "";
    try {
      // Run against the setup route with the super-admin session (dual-auth proxy).
      const res = await fetch(`/api/setup/${m.route}`, { method: "POST", headers: { Authorization: token } });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; action?: string; error?: string };
      body = JSON.stringify(data);
      resultStr = !res.ok || data.error ? `error: ${data.error ?? res.status}` : (data.action ?? "ok");
      // Audit (best-effort).
      await fetch(`/api/admin/migrations?pbToken=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ migration_name: m.route, result: resultStr, response_body: body, duration_ms: Date.now() - start }),
      });
    } catch { resultStr = "error: network"; }
    finally { setRunning(null); }
    setLog((l) => ({ ...l, [m.route]: resultStr }));
    return resultStr;
  }, []);

  const runAll = useCallback(async () => {
    for (const m of migrations) {
      if (m.bootstrap) continue;
      await runOne(m);
    }
    await load();
  }, [migrations, runOne, load]);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="w-full max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-bold" style={{ color: "#F0F0F8", fontSize: "1.4rem" }}>Migrations</h1>
          <button onClick={() => void runAll()} disabled={!!running}
            className="text-sm px-4 py-2 rounded-xl btn-primary text-white font-semibold disabled:opacity-50">
            {running ? "Running…" : "Run all pending"}
          </button>
        </div>
        <p className="text-sm mb-6" style={{ color: "#9090A8" }}>
          Provision the database collections STAFFD needs. Re-running is safe — already-created collections report cleanly.
        </p>

        {error && <p className="text-sm mb-4" style={{ color: "#E08080" }}>{error}</p>}

        <ul className="space-y-3">
          {migrations.map((m) => (
            <li key={m.route} className="rounded-xl px-5 py-4" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: "#F0F0F8" }}>{m.label}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: statusColor[m.status], border: `1px solid ${statusColor[m.status]}40` }}>
                      {statusLabel[m.status]}
                    </span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "#5A5A70" }}>
                    <code>{m.collection}</code>
                    {m.lastRun ? ` · last run ${new Date(m.lastRun.ran_at).toLocaleString()} (${m.lastRun.result})` : " · never run via app"}
                  </p>
                  {m.note && <p className="text-xs mt-1" style={{ color: "#6A6A80" }}>{m.note}</p>}
                  {log[m.route] && <p className="text-xs mt-1" style={{ color: "#7CD992" }}>→ {log[m.route]}</p>}
                </div>
                <button
                  onClick={() => { void runOne(m).then(() => load()); }}
                  disabled={!!running || m.bootstrap}
                  title={m.bootstrap ? "Bootstrap once via CLI (x-setup-secret)" : "Run this migration"}
                  className="text-sm px-3 py-1.5 rounded-lg font-medium shrink-0 disabled:opacity-40"
                  style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#D0D0E0" }}>
                  {running === m.route ? "Running…" : m.bootstrap ? "CLI only" : "Run migration"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
