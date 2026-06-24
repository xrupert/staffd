"use client";

/**
 * GenerationProgress (W95.8.1) — the prominent, animated "your specialist is
 * working" state for image/video generation. Replaces the faded 2px-dot + grey
 * "rendering…" line that customers couldn't see.
 *
 * Two jobs: (1) make the system VISIBLY working — a sweeping indeterminate bar
 * that's always in motion; (2) tell the customer they're free to walk away,
 * because the completion event is already wired (generation.ready → the bell +
 * push). So a minute-long render never traps them on the screen.
 *
 * Self-contained keyframes (scoped class) so the motion never depends on the
 * Tailwind/animation config being present.
 */

type Props = { kind: "image" | "video" };

export default function GenerationProgress({ kind }: Props) {
  const who = kind === "video" ? "Your video specialist" : "Your designer";
  const verb = kind === "video" ? "is filming your video" : "is rendering your image";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: "28px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}
    >
      <style>{`
        @keyframes staffd-gen-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(320%); } }
        @keyframes staffd-gen-glow { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
      `}</style>

      {/* Sweeping indeterminate bar — always in motion */}
      <div
        aria-hidden
        style={{ position: "relative", width: "100%", maxWidth: 260, height: 6, borderRadius: 999, overflow: "hidden", background: "#1A1A24", border: "1px solid #2A2A38" }}
      >
        <div
          style={{
            position: "absolute", top: 0, bottom: 0, width: "30%", borderRadius: 999,
            background: "linear-gradient(90deg, transparent, #5B21E8, #A07BFF, transparent)",
            animation: "staffd-gen-sweep 1.25s ease-in-out infinite",
          }}
        />
      </div>

      <p
        className="text-sm font-semibold"
        style={{ color: "#F0F0F8", animation: "staffd-gen-glow 1.8s ease-in-out infinite" }}
      >
        {who} {verb}…
      </p>

      <p className="text-xs" style={{ color: "#7070A0", textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
        This can take a minute — keep working, we&apos;ll ping the 🔔 the moment it&apos;s ready.
      </p>
    </div>
  );
}
