"use client";

/**
 * SideDrawer — generic slide-in panel (W95.4b).
 *
 * A minimal right-side drawer for read-only detail + a couple of action
 * buttons (the Front Desk list views). Backdrop click + Escape close it
 * (mirrors the ThreadPickerDrawer interaction contract — Standard #9). Parent
 * owns open state. Renders nothing when closed.
 */

import { useEffect } from "react";

export default function SideDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: "380px", height: "100%", background: "#0E0E15", borderLeft: "1px solid #2A2A38", padding: "24px", overflowY: "auto", boxShadow: "-12px 0 40px rgba(0,0,0,0.4)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold" style={{ color: "#F0F0F8", fontSize: "1.05rem" }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-sm px-2 py-1 rounded-lg" style={{ background: "#1A1A24", border: "1px solid #2A2A38", color: "#9090A8" }}>✕</button>
        </div>
        {children}
      </aside>
    </div>
  );
}
