/**
 * PR-Wire-P1 — extractVideoScripts: the script→production linkage parser.
 * Fixture mirrors the live TikTok Strategist deliverable shape that exposed
 * the bug (whole 12-video document fed to the enricher as one prompt).
 */

import { describe, it, expect } from "vitest";
import { extractVideoScripts } from "../../app/lib/video-scripts";

const SERIES = `"Stop Hiring. Start Directing." — TikTok Hook System + 4-Week Content Series

MASTER HOOK (anchor everything to this)
On-screen text: You don't have a hiring problem.

WEEK 1 — "The Problem With Hiring"

Video 1 — Series Anchor 🎬🔁 | 45 seconds

Hook (0–3s): Spoken: "I used to think I needed to hire my way out of every problem."
Beat 1 (3–12s): "A marketer. A salesperson. A bookkeeper."
CTA (42–45s): "Comment 'STAFF' if you're still operating."

Video 2 — "The Hiring Math Is Broken" 🎬 | 30 seconds

Hook (0–3s): Spoken: "Quick math that'll make you sick."
Beat 1 (3–15s): "One marketing hire: $55K salary."

Video 3 — "What Directing Actually Looks Like" 📱🔁 | 30 seconds

Hook (0–3s): On-screen (large text, no speaking for 1s): Watch this.
Beat 1 (3–20s): [Screen record of a STAFFD brief being typed]
CTA (28–30s): "Try it free — link in bio."
`;

describe("extractVideoScripts", () => {
  it("splits the series into one script per video with clean titles", () => {
    const scripts = extractVideoScripts(SERIES);
    expect(scripts.length).toBe(3);
    expect(scripts[0]?.title).toContain("Video 1");
    expect(scripts[0]?.title).toContain("Series Anchor");
    expect(scripts[0]?.title).not.toContain("🎬");
    expect(scripts[2]?.title).toContain("Video 3");
  });

  it("each script carries ONLY its own section", () => {
    const scripts = extractVideoScripts(SERIES);
    expect(scripts[0]?.script).toContain("hire my way out");
    expect(scripts[0]?.script).not.toContain("Quick math");
    expect(scripts[1]?.script).toContain("Quick math");
    expect(scripts[1]?.script).not.toContain("Watch this.");
  });

  it("labels camera-facing scripts as not producible; screen-led as producible", () => {
    const scripts = extractVideoScripts(SERIES);
    expect(scripts[0]?.producible).toBe(false); // 🎬 camera-facing
    expect(scripts[1]?.producible).toBe(false); // 🎬
    expect(scripts[2]?.producible).toBe(true);  // 📱 screen-led
  });

  it("returns [] for deliverables without video sections", () => {
    expect(extractVideoScripts("Here is your NDA draft with standard clauses.")).toEqual([]);
    expect(extractVideoScripts("")).toEqual([]);
  });

  it("a single scripted video still extracts (callers narrow the prompt)", () => {
    const one = `Video 1 — Product Teaser 📱 | 15 seconds\n\nHook: Watch the dashboard build itself.`;
    const scripts = extractVideoScripts(one);
    expect(scripts.length).toBe(1);
    expect(scripts[0]?.producible).toBe(true);
  });

  it("unmarked scripts default to producible", () => {
    const s = extractVideoScripts(`Video 1 — Simple Promo | 20 seconds\n\nHook: A bold claim.\n\nVideo 2 — Follow-up | 20 seconds\n\nHook: The proof.`);
    expect(s.every((x) => x.producible)).toBe(true);
  });
});
