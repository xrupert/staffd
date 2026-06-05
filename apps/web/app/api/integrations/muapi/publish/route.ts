/**
 * /api/integrations/muapi/publish — TEMPORARILY DISABLED (PR-Tranche-1.7 / W17).
 *
 * Muapi removed the platform-publish endpoints (`tiktok-publish`,
 * `youtube-publish`, `instagram-publish`) from their public API. Until they
 * re-expose a platform-publish layer, this route returns HTTP 410 Gone with
 * a brand-voiced response payload. The Social Media Strategist still
 * produces the media + per-platform tuned captions; the operator downloads
 * + posts manually until direct posting reconnects.
 *
 * The file is deliberately preserved (not deleted) so the reconnect PR can
 * fill it back in without changing imports or route registration. Tracking
 * the reconnect under W17.
 *
 * UI surfaces gate on `PUBLISH_ENABLED` from `apps/web/lib/feature-flags.ts`.
 */

const DISABLED_BODY = {
  status: "queued_for_platform_publish",
  message:
    "Your Social Media Strategist drafted this post and the captions are tuned per platform. Direct posting to YouTube and TikTok is being added to the staff this cycle; for now your media + captions are ready to publish from your account in under a minute.",
  next_actions: [
    { label: "Download media", kind: "download" },
    { label: "Copy caption", kind: "copy" },
  ],
} as const;

function gone(): Response {
  return Response.json(DISABLED_BODY, { status: 410 });
}

export async function GET()    { return gone(); }
export async function POST()   { return gone(); }
export async function PUT()    { return gone(); }
export async function PATCH()  { return gone(); }
export async function DELETE() { return gone(); }
