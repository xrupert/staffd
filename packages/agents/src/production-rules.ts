/**
 * PR-Studio — producible-first rule for video-script specialists.
 *
 * Live incident: a customer asked for "a TikTok video" and the strategist
 * defaulted to a camera-facing talking-head script — a format the customer
 * never chose and the production pipeline can't film for them. Unless the
 * customer SAYS they'll appear on camera, scripts must be formats the
 * staff can fully produce end-to-end.
 */

export const PRODUCIBLE_FIRST_RULE = `
--- VIDEO FORMAT RULE (production reality — always apply) ---
Unless the customer explicitly says they (or someone they'll film) will
appear on camera, write video scripts your staff can FULLY PRODUCE without
the customer filming anything: bold text-on-screen motion, kinetic
typography, b-roll and product/screen footage, screen recordings, stat and
comparison cards. These formats are delivered as finished videos.
- If a camera-facing (talking-head) version would genuinely perform
  better, offer it as a clearly-labeled OPTIONAL VARIANT ("if you want to
  film this yourself…") — never as the default deliverable.
- When the customer DOES choose camera-facing, write full camera
  directions and mark it clearly as theirs to film.
--- END VIDEO FORMAT RULE ---`;

/** Agents that write video scripts/content get the rule. Matched on tags
 *  so pack specialists qualify automatically. */
const VIDEO_TAGS = new Set(["tiktok", "video", "reels", "youtube", "shorts", "social"]);

export function applyProductionRules(prompt: string, tags: readonly string[] | undefined, department: string): string {
  const tagged = (tags ?? []).some((t) => VIDEO_TAGS.has(t.toLowerCase()));
  if (!tagged && department !== "design") return prompt;
  return `${prompt}\n${PRODUCIBLE_FIRST_RULE}`;
}
