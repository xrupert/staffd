/**
 * W95.7.3e-vid1 — the prompt enricher must speak VIDEO when the medium is video.
 *
 * The original enricher was an image art-director ("never compress, preserve
 * every strategic choice, 35mm shallow depth of field, lower-third banner") with
 * the word "image" string-swapped to "video". Fed a 30-second multi-scene TikTok
 * script it produced one dense 300-word prompt describing every scene + overlay
 * text at once, and a single ~5s text-to-video model rendered an incoherent
 * blitz. The video variant must instead DISTILL to one renderable shot.
 */

import { describe, it, expect } from "vitest";
import { buildEnricherSystemPrompt } from "../../app/api/_lib/generation/enricher-prompt";

describe("buildEnricherSystemPrompt (vid1)", () => {
  const image = buildEnricherSystemPrompt("image");
  const video = buildEnricherSystemPrompt("video");

  it("image variant keeps the enrich-don't-compress directive", () => {
    expect(image).toMatch(/NEVER COMPRESS/);
  });

  it("video variant distills to a single shot, not the whole script", () => {
    expect(video).toMatch(/single|one continuous shot/i);
    // Text-to-video renders one scene — it must NOT carry the image maximalism.
    expect(video).not.toMatch(/NEVER COMPRESS/);
  });

  it("video variant demands motion and forbids dumping overlay text / scenes", () => {
    expect(video).toMatch(/motion/i);
    expect(video).toMatch(/multiple scenes|cuts|montage/i);
    expect(video).toMatch(/overlay text|captions|hashtags/i);
  });

  it("neither variant leaks platform/model names or aspect flags", () => {
    expect(video).toMatch(/never mention any (platform|external platform or model)/i);
  });
});
