/**
 * S4b — Finishing Touches: per-beat overrides in the spec builder, prompt
 * round-trip, scene breakdown, and the AGPL boundary pin.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildEditDecisions } from "../../app/api/_lib/montage/spec";
import { splitPrompt, scenesFromScript } from "../../app/api/montage/touches/route";

const SCRIPT = `Video 3 — demo 📱 | 30 seconds

Hook (0–3s): Spoken: "This is the hook." On-screen: Watch this.

Beat 1 (3–20s): Spoken: "The middle beat."

CTA (28–30s): "Try it free — link in bio."`;

describe("buildEditDecisions — textOverrides (the director's pass)", () => {
  it("a per-beat override replaces that scene's on-screen copy only", () => {
    const spec = buildEditDecisions(SCRIPT, "t", { textOverrides: { 1: "My rewritten middle" } })!;
    const cuts = spec.cuts as Array<Record<string, unknown>>;
    expect(cuts[1]?.text).toBe("My rewritten middle");
    expect(cuts[0]?.text).toBe("Watch this.");
    expect(cuts[2]?.text).toContain("Try it free");
  });

  it("blank overrides are ignored (never a black scene)", () => {
    const spec = buildEditDecisions(SCRIPT, "t", { textOverrides: { 0: "   " } })!;
    const cuts = spec.cuts as Array<Record<string, unknown>>;
    expect(cuts[0]?.text).toBe("Watch this.");
  });

  it("overrides compose with the outro", () => {
    const spec = buildEditDecisions(SCRIPT, "t", { outroText: "Acme Co", textOverrides: { 0: "New hook" } })!;
    const cuts = spec.cuts as Array<Record<string, unknown>>;
    expect(cuts[0]?.text).toBe("New hook");
    expect(cuts[cuts.length - 1]).toMatchObject({ type: "logo_outro", text: "Acme Co" });
  });
});

describe("splitPrompt — ledger prompt round-trip", () => {
  it("splits `title\\n\\nscript` back apart", () => {
    const { title, script } = splitPrompt(`My video\n\n${SCRIPT}`);
    expect(title).toBe("My video");
    expect(script).toBe(SCRIPT);
  });

  it("promptless-title fallback", () => {
    expect(splitPrompt("just a script").title).toBe("Your video");
  });
});

describe("scenesFromScript — the UI's scene breakdown", () => {
  it("indexes beats with type + timing, on-screen copy first", () => {
    const scenes = scenesFromScript(SCRIPT);
    expect(scenes.length).toBe(3);
    expect(scenes[0]).toMatchObject({ index: 0, type: "hero_title", text: "Watch this.", startS: 0, endS: 3 });
    expect(scenes[2]?.type).toBe("callout");
  });
});

describe("AGPL boundary pin (S4b)", () => {
  it("the Finishing Touches UI imports nothing from OpenMontage/@remotion", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "components", "FinishingTouchesModal.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/from ["'].*remotion/i);
    expect(src).not.toMatch(/from ["'].*openmontage/i);
    expect(src).not.toMatch(/from ["'].*montage-composer/i);
  });
});
