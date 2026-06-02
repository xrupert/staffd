"use client";

/**
 * Settings → Push notifications toggle (Phase 7).
 *
 * Coordinates the browser permission prompt + service worker subscription +
 * server-side `push_subscriptions` row. Idempotent: re-toggling does the
 * right thing.
 *
 * UX states:
 *   • unsupported  — browser doesn't support push (Safari < 16.4 on iOS, etc.)
 *   • not_configured — server VAPID keys not set
 *   • disabled  — never enabled, show "Enable" button
 *   • enabled   — subscription active, show "Disable" + "Send test"
 *   • blocked   — user denied browser permission, show recovery hint
 */

import { useCallback, useEffect, useState } from "react";
import pb from "../../lib/pb";

type State =
  | "loading"
  | "unsupported"
  | "not_configured"
  | "disabled"
  | "enabled"
  | "blocked"
  | "error";

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  // Return a fresh ArrayBuffer (not Uint8Array<ArrayBufferLike>) so it
  // satisfies the `BufferSource` type expected by `applicationServerKey`.
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export default function PushNotificationsToggle() {
  const [state, setState] = useState<State>("loading");
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    try {
      const res = await fetch("/api/push/subscribe", { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setState("not_configured");
        return;
      }
      setVapidKey(data.vapidPublicKey ?? null);

      const reg = await navigator.serviceWorker.getRegistration();
      const existing = await reg?.pushManager.getSubscription();
      setState(existing ? "enabled" : "disabled");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function enable() {
    if (!vapidKey) return;
    setWorking(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setState("blocked");
        setMsg({ ok: false, text: "Permission denied. You can re-enable notifications in your browser settings." });
        return;
      }
      if (perm !== "granted") {
        setMsg({ ok: false, text: "Permission was not granted." });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(vapidKey),
      });

      const userId = pb.authStore.record?.id ?? "";
      const token = pb.authStore.token;
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          pbToken: token,
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) {
        setMsg({ ok: false, text: "Couldn't register with the server. Try again." });
        return;
      }
      setState("enabled");
      setMsg({ ok: true, text: "Notifications enabled. You'll get your Morning Brief on your phone." });
    } catch (err) {
      setMsg({ ok: false, text: `Subscribe failed: ${(err as Error).message}` });
    } finally {
      setWorking(false);
    }
  }

  async function disable() {
    setWorking(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => undefined);
        const userId = pb.authStore.record?.id ?? "";
        const token = pb.authStore.token;
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, pbToken: token, endpoint }),
        }).catch(() => undefined);
      }
      setState("disabled");
      setMsg({ ok: true, text: "Notifications disabled." });
    } catch (err) {
      setMsg({ ok: false, text: `Disable failed: ${(err as Error).message}` });
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="rounded-2xl p-6 mb-5"
      style={{ background: "#111118", border: "1px solid #2A2A38" }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>Push notifications</h2>
          <p className="text-xs mt-1" style={{ color: "#9090A8" }}>
            Get your Morning Brief and important alerts on your phone, the moment your staff finishes them.
          </p>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-md mt-0.5 flex-shrink-0"
          style={pillStyle(state)}
        >
          {pillLabel(state)}
        </span>
      </div>

      {state === "unsupported" && (
        <p className="text-xs" style={{ color: "#9090A8" }}>
          Your browser doesn't support web push. Open STAFFD in a recent version of Chrome, Edge, Firefox, or Safari 16.4+ on iOS.
        </p>
      )}

      {state === "not_configured" && (
        <p className="text-xs" style={{ color: "#9090A8" }}>
          Push isn't configured on the server yet. (Operator: set VAPID env vars.)
        </p>
      )}

      {state === "disabled" && (
        <button
          onClick={() => void enable()}
          disabled={working}
          className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ opacity: working ? 0.5 : 1 }}
        >
          {working ? "Enabling…" : "Enable notifications"}
        </button>
      )}

      {state === "enabled" && (
        <button
          onClick={() => void disable()}
          disabled={working}
          className="px-4 py-2 rounded-xl text-xs font-medium transition-colors"
          style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: working ? "#5A5A70" : "#D0D0E8", opacity: working ? 0.6 : 1 }}
        >
          {working ? "Disabling…" : "Disable notifications"}
        </button>
      )}

      {state === "blocked" && (
        <p className="text-xs" style={{ color: "#F59E0B" }}>
          Notifications are blocked in your browser settings. Re-enable them for this site, then refresh.
        </p>
      )}

      {msg && (
        <p className="text-xs mt-3" style={{ color: msg.ok ? "#22C55E" : "#EF4444" }}>{msg.text}</p>
      )}
    </section>
  );
}

function pillLabel(state: State): string {
  switch (state) {
    case "enabled":        return "ON";
    case "disabled":       return "OFF";
    case "blocked":        return "BLOCKED";
    case "unsupported":    return "UNSUPPORTED";
    case "not_configured": return "UNAVAILABLE";
    case "loading":        return "…";
    case "error":          return "ERROR";
  }
}

function pillStyle(state: State): React.CSSProperties {
  const map: Record<State, { bg: string; fg: string; border: string }> = {
    enabled:        { bg: "rgba(34,197,94,0.10)",  fg: "#22C55E", border: "rgba(34,197,94,0.25)" },
    disabled:       { bg: "rgba(144,144,168,0.10)", fg: "#9090A8", border: "rgba(144,144,168,0.25)" },
    blocked:        { bg: "rgba(245,158,11,0.10)", fg: "#F59E0B", border: "rgba(245,158,11,0.25)" },
    unsupported:    { bg: "rgba(144,144,168,0.10)", fg: "#9090A8", border: "rgba(144,144,168,0.25)" },
    not_configured: { bg: "rgba(144,144,168,0.10)", fg: "#9090A8", border: "rgba(144,144,168,0.25)" },
    loading:        { bg: "rgba(144,144,168,0.10)", fg: "#9090A8", border: "rgba(144,144,168,0.25)" },
    error:          { bg: "rgba(239,68,68,0.10)",  fg: "#EF4444", border: "rgba(239,68,68,0.25)" },
  };
  const c = map[state];
  return {
    display: "inline-block",
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    padding: "3px 8px",
    borderRadius: "999px",
  };
}
