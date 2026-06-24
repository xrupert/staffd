"use client";

/**
 * NotificationBell (W95.8) — the customer's notification inbox surface. Reads
 * the user's own `notifications` rows (USER_OWNED, secured by row rules), shows
 * an unread count, and a dropdown to read + click through. Marking read and the
 * click-through go straight to PB (no extra API route needed). Degrades to an
 * empty, silent bell if the collection isn't provisioned yet.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  severity: string;
  read: boolean;
  created: string;
}

const ACCENT: Record<string, string> = { info: "#5B21E8", success: "#22C55E", warning: "#F59E0B" };

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;

  async function load() {
    try {
      const uid = pb.authStore.record?.id ?? "";
      if (!uid) return;
      const res = await pb.collection("notifications").getList(1, 20, { filter: `user = '${uid}'`, sort: "-created" });
      setItems(res.items as unknown as Notification[]);
    } catch {
      /* collection not provisioned yet → empty, silent bell */
    }
  }
  // W95.8.1 — live bell: poll + refresh on tab focus, so a generation that
  // finishes while the customer is elsewhere surfaces within ~20s (not on next
  // reload). The completion event is already produced server-side
  // (generation.ready → this collection); this is what lets them walk away.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 20000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, []);

  async function markRead(n: Notification) {
    if (n.read) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    try { await pb.collection("notifications").update(n.id, { read: true }); } catch { /* best-effort */ }
  }

  async function markAll() {
    const unreadItems = items.filter((n) => !n.read);
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    for (const n of unreadItems) { try { await pb.collection("notifications").update(n.id, { read: true }); } catch { /* best-effort */ } }
  }

  function onRow(n: Notification) {
    void markRead(n);
    if (!n.href) return;
    if (/^https?:\/\//.test(n.href)) window.open(n.href, "_blank", "noopener");
    else window.location.href = n.href;
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center rounded-full transition-colors"
        style={{ width: 34, height: 34, background: "#14141C", border: "1px solid #2A2A38", color: "#9090A8" }}
      >
        <span aria-hidden style={{ fontSize: 15 }}>🔔</span>
        {unread > 0 && (
          <>
            {/* W95.8.1 — pulsing ring draws the eye the moment work lands */}
            <span
              aria-hidden
              className="animate-ping"
              style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: 8, background: "#5B21E8", opacity: 0.5 }}
            />
            <span
              aria-label={`${unread} unread`}
              style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "#5B21E8", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          style={{ position: "absolute", right: 0, top: 42, width: 340, maxHeight: 420, overflowY: "auto", zIndex: 50, background: "#111118", border: "1px solid #2A2A38", borderRadius: 14, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #1E1E2A" }}>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>Notifications</span>
            {unread > 0 && (
              <button onClick={() => void markAll()} className="text-xs transition-colors hover:text-white" style={{ color: "#5A5A70" }}>Mark all read</button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-xs text-center px-4 py-8" style={{ color: "#5A5A70" }}>You're all caught up.</p>
          ) : (
            <div className="flex flex-col">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onRow(n)}
                  className="text-left px-4 py-3 transition-colors"
                  style={{ borderBottom: "1px solid #16161E", background: n.read ? "transparent" : "rgba(91,33,232,0.06)", cursor: n.href ? "pointer" : "default" }}
                >
                  <span className="flex items-start gap-2.5">
                    <span aria-hidden style={{ marginTop: 5, width: 7, height: 7, borderRadius: 4, flexShrink: 0, background: n.read ? "#2A2A38" : (ACCENT[n.severity] ?? "#5B21E8") }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium" style={{ color: "#F0F0F8" }}>{n.title}</span>
                      <span className="block text-xs mt-0.5" style={{ color: "#7070A0" }}>{n.body}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
