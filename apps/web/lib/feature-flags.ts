// PR-Tranche-1.7 — feature flags for capabilities that are queued for a
// future cycle. Keep this file boring: pure boolean exports, no env reads.
//
// Flip a flag to `true` only when the underlying capability is wired
// end-to-end (route, UI, copy, docs).

/**
 * Direct social-platform publishing (TikTok / YouTube / Instagram). Disabled
 * pending Muapi's platform-publish layer (tracked under W17). When disabled,
 * the `/api/integrations/muapi/publish` route returns HTTP 410 and all UI
 * publish buttons are hidden — operator downloads + copies the per-platform
 * caption from the output panel and posts manually.
 */
export const PUBLISH_ENABLED = false;

/**
 * Inline brand-voiced note shown in place of the hidden publish buttons.
 * Lives here (not in DepartmentRoom.tsx) so any future surface that adds
 * publish UI reuses the same wording. Do not paraphrase — locked copy per
 * PR-Tranche-1.7 spec.
 */
export const PUBLISH_DISABLED_NOTE =
  "Your media is ready. Direct posting lights up next cycle — for now grab the download and copy the caption.";
