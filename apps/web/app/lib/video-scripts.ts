/**
 * PR-Wire-P1 — script→production linkage.
 *
 * When a strategist deliverable contains MULTIPLE scripted videos (the
 * "12-video TikTok series" shape), the generate-video path previously fed
 * the ENTIRE document to the enricher, which had to guess which video to
 * render. This extractor finds the individual video scripts so each can
 * surface as its own "Produce this video" chip carrying ONLY its script.
 *
 * Producibility (the honest label): scripts marked camera-facing (🎬)
 * need the OWNER on camera — no pipeline can film them. Screen/text-led
 * scripts (📱, or unmarked) are AI-producible today.
 */

export type VideoScript = {
  /** e.g. "Video 1 — Series Anchor" (marker emoji stripped) */
  title: string;
  /** The full script section for this one video */
  script: string;
  /** false = camera-facing (needs the owner on camera) */
  producible: boolean;
};

const SECTION_SPLIT = /(?=^\s*(?:\*\*)?Video\s+\d+\s*[—–-])/im;
const TITLE_LINE = /^\s*(?:\*\*)?(Video\s+\d+[^\n|]*?)(?:\|[^\n]*)?$/im;

export function extractVideoScripts(output: string): VideoScript[] {
  if (!output || !/Video\s+\d+\s*[—–-]/i.test(output)) return [];

  const parts = output.split(SECTION_SPLIT).filter((p) => /^\s*(?:\*\*)?Video\s+\d+\s*[—–-]/i.test(p));
  if (parts.length === 0) return [];

  const scripts = parts.map((part) => {
    const m = part.match(TITLE_LINE);
    const rawTitle = (m?.[1] ?? "Video").trim();
    const cameraFacing = /🎬/.test(rawTitle) || /🎬/.test(part.slice(0, 200));
    const screenLed = /📱/.test(rawTitle) || /📱/.test(part.slice(0, 200));
    const title = rawTitle
      .replace(/[🎬📱🔁⚡]/gu, "")
      .replace(/\*\*/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return {
      title,
      script: part.trim(),
      producible: screenLed || !cameraFacing,
    };
  });

  // A single "Video 1" mention isn't a series — still useful (the one
  // script beats the whole document), so return it; callers decide how
  // to render 1 vs many.
  return scripts;
}
