"use client";

/**
 * /dashboard/admin/health — V1 Substrate Health (W95.7).
 *
 * Single-page green/red readout of /api/admin/health. Super-admin gated by the
 * parent admin layout. The operator's one-glance "is V1 healthy?" surface.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import pb from "../../../../lib/pb";
import type { HealthReport } from "../../../api/_lib/admin/health";

const card: React.CSSProperties = { background: "#111118", border: "1px solid #2A2A38", borderRadius: "16px", padding: "20px" };

function Dot({ ok }: { ok: boolean }) {
  return <span style={{ color: ok ? "#22C55E" : "#EF4444", fontSize: "13px", lineHeight: 1 }}>{ok ? "●" : "●"}</span>;
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: "1px solid #1E1E2A" }}>
      <span className="flex items-center gap-2 min-w-0">
        <Dot ok={ok} />
        <span className="text-sm truncate" style={{ color: "#D0D0E8" }}>{label}</span>
      </span>
      <span className="text-xs flex-shrink-0 text-right" style={{ color: ok ? "#5A5A70" : "#EF8A8A" }}>{detail}</span>
    </div>
  );
}

export default function HealthPage() {
  const [data, setData] = useState<(HealthReport & { generatedAt: string }) | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/health", { headers: { Authorization: pb.authStore.token } });
        if (!res.ok) { setError(res.status === 403 ? "Super-admin only." : "Couldn't load health."); return; }
        setData(await res.json());
      } catch { setError("Couldn't load health."); }
    })();
  }, []);

  return (
    <main className="min-h-screen" style={{ background: "#09090F" }}>
      <div className="relative z-10 w-full max-w-3xl mx-auto px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <a href="/dashboard/admin"><Image src="/logo-light.png" alt="STAFFD" width={86} height={38} style={{ objectFit: "contain" }} /></a>
          <a href="/dashboard/admin" className="text-xs hover:text-white" style={{ color: "#5A5A70", textDecoration: "none" }}>← Admin</a>
        </header>

        <h1 className="font-bold mb-1" style={{ color: "#F0F0F8", fontSize: "1.6rem" }}>Substrate Health</h1>
        <p className="text-sm mb-6" style={{ color: "#7070A0" }}>V1 substrate self-check. Green everywhere = shippable.</p>

        {error && <div style={{ ...card, color: "#F59E0B" }}>{error}</div>}
        {!error && !data && <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>}

        {data && (
          <>
            <div style={{ ...card, marginBottom: "16px", borderColor: data.ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.5)" }}>
              <div className="flex items-center gap-3">
                <span style={{ fontSize: "22px" }}>{data.ok ? "✅" : "🚨"}</span>
                <div>
                  <p className="font-bold" style={{ color: data.ok ? "#22C55E" : "#EF4444", fontSize: "1.1rem" }}>{data.ok ? "V1 substrate healthy" : "Substrate needs attention"}</p>
                  <p className="text-xs" style={{ color: "#5A5A70" }}>Checked {new Date(data.generatedAt).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <section style={card}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Collections</p>
                <Row label={`${data.collections.found_count} present / ${data.collections.expected_count} expected`} ok={data.collections.missing.length === 0} detail={data.collections.missing.length ? `missing: ${data.collections.missing.join(", ")}` : "all present"} />
                {data.collections.extra.length > 0 && <p className="text-xs mt-2" style={{ color: "#5A5A70" }}>Extra (unexpected): {data.collections.extra.join(", ")}</p>}
              </section>

              <section style={card}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Intent handlers</p>
                <Row label={`${data.intents.expected.length} intents wired`} ok={data.intents.missing_handlers.length === 0} detail={data.intents.missing_handlers.length ? `missing: ${data.intents.missing_handlers.join(", ")}` : "all wired"} />
              </section>

              <section style={card}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Workers</p>
                <Row label={`${data.workers.registered.length} registered / ${data.workers.expected.length} expected`} ok={data.workers.missing.length === 0} detail={data.workers.missing.length ? `missing: ${data.workers.missing.join(", ")}` : "all registered"} />
              </section>

              <section style={card}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Migrations</p>
                <Row label={`${data.migrations.applied} / ${data.migrations.total} applied`} ok={data.migrations.pending.length === 0} detail={data.migrations.pending.length ? `pending: ${data.migrations.pending.join(", ")}` : "all applied"} />
              </section>

              <section style={card}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#6060A0" }}>Recipes</p>
                <Row label={`${data.recipes.registered.length} recipes`} ok={data.recipes.missing.length === 0 && data.recipes.paradigm_doc_in_sync} detail={data.recipes.missing.length ? `missing: ${data.recipes.missing.join(", ")}` : data.recipes.paradigm_doc_in_sync ? "in sync" : "drifted"} />
              </section>

              <section style={card}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6060A0" }}>Vendor backends</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(data.vendor_clients).map(([name, v]) => (
                    <div key={name} className="rounded-lg p-2.5 flex items-center gap-2" style={{ background: "#1A1A24", border: "1px solid #2A2A38" }}>
                      <Dot ok={v.env_configured} />
                      <span className="text-xs capitalize" style={{ color: "#D0D0E8" }}>{name}</span>
                      <span className="text-xs ml-auto" style={{ color: "#5A5A70" }}>{v.env_configured ? "configured" : "off"}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs mt-3" style={{ color: "#5A5A70" }}>Vendor backends are operator-shared infrastructure; &quot;off&quot; just means that env isn&apos;t set in this environment.</p>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
