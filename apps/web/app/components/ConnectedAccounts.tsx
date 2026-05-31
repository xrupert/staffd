"use client";

/**
 * Connected Accounts — lets users link their TikTok, YouTube, and Instagram
 * accounts so STAFFD can publish generated work directly.
 *
 * STAFFD doesn't handle the OAuth handshake — Muapi does. We surface the
 * connection point as a clean STAFFD UI and link out to Muapi for the
 * actual handshake. After they connect on Muapi, all publish actions in
 * STAFFD work transparently.
 */

const PLATFORMS = [
  {
    id: "tiktok",
    label: "TikTok",
    emoji: "🎵",
    color: "#000000",
    accent: "rgba(255,255,255,0.05)",
    desc: "Publish short-form videos straight from the Design and Marketing departments.",
  },
  {
    id: "youtube",
    label: "YouTube",
    emoji: "▶️",
    color: "#FF0000",
    accent: "rgba(255,0,0,0.05)",
    desc: "Push generated videos to your channel as Shorts or standard uploads.",
  },
  {
    id: "instagram",
    label: "Instagram",
    emoji: "📷",
    color: "#E4405F",
    accent: "rgba(228,64,95,0.05)",
    desc: "Post images and Reels directly to your connected business account.",
  },
];

const MUAPI_DASHBOARD = "https://muapi.ai/dashboard/connections";

export default function ConnectedAccounts() {
  return (
    <section className="rounded-2xl p-6 mb-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
      <div className="mb-5">
        <h2 className="text-sm font-semibold mb-1" style={{ color: "#F0F0F8" }}>Connected Accounts</h2>
        <p className="text-xs" style={{ color: "#5A5A70" }}>
          Link your social accounts so your staff can publish work in one click.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {PLATFORMS.map((p) => (
          <div
            key={p.id}
            className="rounded-xl flex items-center gap-4 px-4 py-3"
            style={{ background: p.accent, border: "1px solid #2A2A38" }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
              style={{ background: "#0D0D14", border: "1px solid #2A2A38" }}
            >
              {p.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#F0F0F8" }}>{p.label}</p>
              <p className="text-xs leading-snug" style={{ color: "#6060A0" }}>{p.desc}</p>
            </div>
            <a
              href={MUAPI_DASHBOARD}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0"
              style={{
                background: "rgba(91,33,232,0.15)",
                border: "1px solid rgba(91,33,232,0.3)",
                color: "#A07BFF",
                textDecoration: "none",
              }}
            >
              Connect →
            </a>
          </div>
        ))}
      </div>

      <p className="text-xs mt-4" style={{ color: "#3A3A55", lineHeight: 1.5 }}>
        Connections are managed via your STAFFD-linked publishing partner. After you
        connect once, every &ldquo;Publish to&hellip;&rdquo; button across STAFFD works
        without re-authorizing.
      </p>
    </section>
  );
}
