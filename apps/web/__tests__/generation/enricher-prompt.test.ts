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

  it("image variant DISTILLS to the requested artifact — never transcribes the brief as a document", () => {
    // W95.9.x — the maximalist 'preserve every word / render all text' enricher
    // turned a logo brief into a photo of a brief on a desk. The fix: distill.
    expect(image).toMatch(/distil/i);
    expect(image).not.toMatch(/NEVER COMPRESS/);
    // Must explicitly forbid rendering the brief/strategy doc as the image.
    expect(image).toMatch(/strategy|brief|document|folder|desk/i);
  });

  it("image variant is logo-aware (a clean iconic mark, not a mockup of options)", () => {
    expect(image).toMatch(/logo|brand mark/i);
    expect(image).toMatch(/iconic|vector|flat/i);
    // Never invent a brand name when none was given.
    expect(image).toMatch(/never invent|text-free/i);
  });

  it("video variant distills to a single shot, not the whole script", () => {
    expect(video).toMatch(/single|one continuous shot/i);
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
