"use client";

/**
 * ThreadPickerDrawer — Phase 25.
 *
 * Slide-in panel listing the user's recent conversation threads with
 * rename + archive + switch actions. Parent owns the open/close state and
 * the active `threadId` so we can highlight the current row and hand back
 * a hydrated message history when the user switches.
 *
 * Renders nothing when closed. Backdrop click + Escape close the drawer.
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type ThreadSummary = {
  threadId: string;
  department?: string;
  agentId?: string;
  preview: string;
  lastAt: string;
  turnCount: number;
  name?: string;
  archived?: boolean;
};

type TurnRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created: string;
};

export type HydratedMessage = {
  role: "user" | "assistant";
  content: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Active thread id; highlighted in the list. */
  currentThreadId: string;
  /** Caller hydrates CommandCenter with the loaded history + sets the threadId. */
  onSwitch: (threadId: string, messages: HydratedMessage[]) => void;
  /** Caller resets the CommandCenter state + rotates the threadId. */
  onNewThread: () => void;
};

function relativeTime(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return new Date(iso.replace(" ", "T")).toLocaleDateString();
}

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", design: "Design",
  "paid-media": "Paid Media", reputation: "Reputation", ceo: "The CEO",
};

export default function ThreadPickerDrawer({
  open,
  onClose,
  currentThreadId,
  onSwitch,
  onNewThread,
}: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/conversations/list?userId=${encodeURIComponent(userId)}${showArchived ? "&includeArchived=1" : ""}`;
      const res = await fetch(url, { headers: { Authorization: token } });
      if (res.ok) {
        const data = await res.json();
        setThreads((data.threads ?? []) as ThreadSummary[]);
      } else {
        setError("load_failed");
      }
    } catch {
      setError("network_error");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  // Re-load whenever the drawer opens.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function switchToThread(threadId: string) {
    if (threadId === currentThreadId) {
      onClose();
      return;
    }
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setBusyThreadId(threadId);
    setError(null);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(threadId)}?userId=${encodeURIComponent(userId)}`,
        { headers: { Authorization: token } }
      );
      if (!res.ok) { setError("switch_failed"); setBusyThreadId(null); return; }
      const data = await res.json();
      const turns = (data.turns ?? []) as TurnRow[];
      const messages: HydratedMessage[] = turns
        .filter((t) => t.role === "user" || t.role === "assistant")
        .map((t) => ({ role: t.role as "user" | "assistant", content: t.content }));
      onSwitch(threadId, messages);
      onClose();
    } catch {
      setError("network_error");
    } finally {
      setBusyThreadId(null);
    }
  }

  async function rename(threadId: string, name: string) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setBusyThreadId(threadId);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, name }),
      });
      if (res.ok) {
        setThreads((prev) => prev.map((t) => t.threadId === threadId ? { ...t, name } : t));
      } else {
        setError("rename_failed");
      }
    } catch {
      setError("network_error");
    } finally {
      setRenamingId(null);
      setBusyThreadId(null);
    }
  }

  async function toggleArchive(threadId: string, archived: boolean) {
    const userId = pb.authStore.record?.id ?? "";
    const token = pb.authStore.token;
    if (!userId || !token) return;
    setBusyThreadId(threadId);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, archived }),
      });
      if (res.ok) {
        // If archiving and we don't show archived, remove from list; otherwise update flag.
        if (archived && !showArchived) {
          setThreads((prev) => prev.filter((t) => t.threadId !== threadId));
        } else {
          setThreads((prev) => prev.map((t) => t.threadId === threadId ? { ...t, archived } : t));
        }
      } else {
        setError("archive_failed");
      }
    } catch {
      setError("network_error");
    } finally {
      setBusyThreadId(null);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.6)" }}
      />
      {/* Drawer */}
      <aside
        className="fixed top-0 left-0 bottom-0 z-50 flex flex-col w-full max-w-sm"
        style={{ background: "#0D0D14", borderRight: "1px solid #2A2A38" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid #1E1E2A" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-base"
              style={{ background: "rgba(91,33,232,0.18)", border: "1px solid rgba(91,33,232,0.35)" }}
            >
              💬
            </div>
            <div>
              <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>Threads</p>
              <p className="text-xs" style={{ color: "#5A5A70" }}>
                {threads.length} {showArchived ? "total" : "active"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#5A5A70" }}
          >
            Close
          </button>
        </div>

        {/* Actions row */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <button
            onClick={() => { onNewThread(); onClose(); }}
            className="btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
          >
            + New thread
          </button>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "#9090A8" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              style={{ accentColor: "#5B21E8" }}
            />
            Show archived
          </label>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {loading && (
            <p className="text-xs px-2 py-4 text-center" style={{ color: "#5A5A70" }}>Loading…</p>
          )}
          {!loading && threads.length === 0 && (
            <p className="text-xs px-2 py-6 text-center" style={{ color: "#5A5A70" }}>
              No threads yet. Start a conversation in the Command Center to see it here.
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {threads.map((t) => {
              const isCurrent = t.threadId === currentThreadId;
              const isBusy = busyThreadId === t.threadId;
              const isRenaming = renamingId === t.threadId;
              const displayName = t.name?.trim() || t.preview.trim().split("\n")[0] || "Untitled thread";
              return (
                <li
                  key={t.threadId}
                  className="rounded-xl px-3 py-2.5 transition-all"
                  style={{
                    background: isCurrent ? "rgba(91,33,232,0.10)" : "transparent",
                    border: `1px solid ${isCurrent ? "rgba(91,33,232,0.30)" : "transparent"}`,
                  }}
                >
                  {isRenaming ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); void rename(t.threadId, renameValue.trim()); }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 rounded-md px-2 py-1 text-xs outline-none"
                        style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#F0F0F8" }}
                      />
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="text-xs font-semibold"
                        style={{ color: "#A07BFF", opacity: isBusy ? 0.5 : 1 }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="text-xs"
                        style={{ color: "#5A5A70" }}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        onClick={() => void switchToThread(t.threadId)}
                        disabled={isBusy}
                        className="w-full text-left"
                        style={{ background: "transparent", border: "none", cursor: isBusy ? "wait" : "pointer", padding: 0 }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: isCurrent ? "#F0F0F8" : "#D0D0E8" }}
                            title={displayName}
                          >
                            {displayName}
                          </p>
                          <span className="text-xs flex-shrink-0" style={{ color: "#5A5A70" }}>
                            {relativeTime(t.lastAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {t.department && (
                            <span className="text-xs" style={{ color: "#7070A0" }}>
                              {DEPT_LABELS[t.department] ?? t.department}
                            </span>
                          )}
                          <span className="text-xs" style={{ color: "#5A5A70" }}>·</span>
                          <span className="text-xs" style={{ color: "#5A5A70" }}>
                            {t.turnCount} turn{t.turnCount === 1 ? "" : "s"}
                          </span>
                          {t.archived && (
                            <>
                              <span className="text-xs" style={{ color: "#5A5A70" }}>·</span>
                              <span className="text-xs" style={{ color: "#F59E0B" }}>archived</span>
                            </>
                          )}
                          {isCurrent && (
                            <>
                              <span className="text-xs" style={{ color: "#5A5A70" }}>·</span>
                              <span className="text-xs font-semibold" style={{ color: "#A07BFF" }}>current</span>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={() => { setRenamingId(t.threadId); setRenameValue(displayName); }}
                          disabled={isBusy}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#5A5A70", opacity: isBusy ? 0.5 : 1 }}
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => void toggleArchive(t.threadId, !t.archived)}
                          disabled={isBusy}
                          className="text-xs transition-colors hover:text-white"
                          style={{ color: "#5A5A70", opacity: isBusy ? 0.5 : 1 }}
                        >
                          {t.archived ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {error && (
            <p className="text-xs px-2 mt-3" style={{ color: "#EF4444" }}>{error}</p>
          )}
        </div>
      </aside>
    </>
  );
}
