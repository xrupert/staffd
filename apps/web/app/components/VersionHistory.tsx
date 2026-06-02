"use client";

/**
 * VersionHistory — Phase 27.
 *
 * Collapsible "History" footer on DraftEditor. Lists prior versions, previews
 * any selected version's content, and restores. Collapsed by default so the
 * editor stays clean for users who never edit.
 *
 * Self-contained data layer — fetches /api/documents/[id]/versions on demand
 * (when the panel opens) and again after every restore. Parent passes
 * documentId + onRestored callback so it can refresh its own content state.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type VersionMeta = {
  id: string;
  version_number: number;
  char_count: number;
  source: "edit" | "restore" | "regenerate";
  restored_from?: number;
  created: string;
};

type VersionFull = VersionMeta & { content: string };

type Props = {
  documentId: string;
  /** Called after a successful restore with the new live content. */
  onRestored?: (content: string) => void;
};

const cardBg: React.CSSProperties = { background: "#0D0D14", border: "1px solid #1E1E2A" };

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function sourceLabel(v: VersionMeta): string {
  if (v.source === "restore") return `Restored from v${v.restored_from ?? "?"}`;
  if (v.source === "regenerate") return "Regenerated";
  return "Edit";
}

export default function VersionHistory({ documentId, onRestored }: Props) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<VersionFull | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setLoading(true);
    try {
      const url = `/api/documents/${encodeURIComponent(documentId)}/versions?userId=${encodeURIComponent(userId)}&pbToken=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions ?? []);
      } else {
        setVersions([]);
      }
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (open && versions === null) void load();
  }, [open, versions, load]);

  async function preview(v: VersionMeta) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    const url = `/api/documents/${encodeURIComponent(documentId)}/versions?userId=${encodeURIComponent(userId)}&pbToken=${encodeURIComponent(token)}&withContent=true`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const full = (data.versions as VersionFull[]).find((x) => x.version_number === v.version_number);
      if (full) setSelected(full);
    } catch { /* silent */ }
  }

  async function restore(v: VersionMeta) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    if (!confirm(`Restore version ${v.version_number}? Your current draft will be saved as a new version first so you can undo.`)) return;

    setRestoring(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/restore-version`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, versionNumber: v.version_number }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Re-fetch full content of the restored version so we can hand it back.
        if (selected && selected.version_number === v.version_number) {
          onRestored?.(selected.content);
        } else {
          await preview(v);
          if (selected) onRestored?.(selected.content);
        }
        setMsg({ ok: true, text: `Restored. Your staff will refresh their memory shortly.` });
        setVersions(null); // force reload — show the new restore marker
        await load();
      } else {
        setMsg({ ok: false, text: data.error ?? "restore_failed" });
      }
    } catch {
      setMsg({ ok: false, text: "network_error" });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs transition-colors hover:text-white"
        style={{ background: "none", border: "none", color: "#6060A0", cursor: "pointer", padding: 0 }}
      >
        {open ? "▾" : "▸"} History{versions ? ` (${versions.length})` : ""}
      </button>

      {open && (
        <div className="mt-2 rounded-xl p-4" style={cardBg}>
          {loading && <p className="text-xs" style={{ color: "#5A5A70" }}>Loading…</p>}
          {!loading && versions && versions.length === 0 && (
            <p className="text-xs" style={{ color: "#5A5A70" }}>
              No earlier versions. Edits made from now on will appear here.
            </p>
          )}
          {!loading && versions && versions.length > 0 && (
            <div className="flex flex-col gap-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{
                    background: selected?.version_number === v.version_number ? "rgba(91,33,232,0.08)" : "transparent",
                    border: "1px solid #1E1E2A",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: "#D0D0E8" }}>
                      v{v.version_number} · {sourceLabel(v)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#5A5A70" }}>
                      {formatRelative(v.created)} · {v.char_count.toLocaleString()} chars
                    </p>
                  </div>
                  <button
                    onClick={() => void preview(v)}
                    disabled={restoring}
                    className="text-xs transition-colors hover:text-white"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#A07BFF", opacity: restoring ? 0.5 : 1 }}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => void restore(v)}
                    disabled={restoring}
                    className="text-xs font-semibold transition-colors"
                    style={{
                      background: "rgba(91,33,232,0.08)",
                      border: "1px solid rgba(91,33,232,0.25)",
                      color: "#A07BFF",
                      padding: "3px 10px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      opacity: restoring ? 0.5 : 1,
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1E1E2A" }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold" style={{ color: "#D0D0E8" }}>
                  Preview · v{selected.version_number}
                </p>
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#5A5A70" }}
                >
                  Close
                </button>
              </div>
              <pre
                className="text-xs whitespace-pre-wrap rounded-lg p-3 overflow-auto"
                style={{
                  background: "#09090F",
                  border: "1px solid #1E1E2A",
                  color: "#9090A8",
                  maxHeight: "280px",
                  fontFamily: "inherit",
                  lineHeight: 1.55,
                }}
              >
                {selected.content}
              </pre>
            </div>
          )}

          {msg && (
            <p className="text-xs mt-3" style={{ color: msg.ok ? "#22C55E" : "#EF4444" }}>{msg.text}</p>
          )}
        </div>
      )}
    </div>
  );
}
