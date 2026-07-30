/**
 * PR-Loop-V3 (#5) — verifyOrCorrect: the diamond's verification node for
 * single-call surfaces. Pass-through on good output, one corrective
 * retry on bad, honest failure when both attempts flunk the evidence.
 */

import { describe, it, expect, vi } from "vitest";
import { verifyOrCorrect } from "../../app/api/_lib/loop/verify";

const GOOD =
  "## Weekly Briefing\n\nYour staff produced twelve deliverables this month. The top priority this week is finalizing the spring campaign before Thursday's launch window.";
const LEAKY =
  "## Weekly Briefing\n\nYour visuals were produced through Muapi this month and the campaign deliverables are ready for your review across departments.";

describe("verifyOrCorrect", () => {
  it("good output passes without regeneration", async () => {
    const regenerate = vi.fn();
    const out = await verifyOrCorrect({ text: GOOD, regenerate });
    expect(out).toEqual({ verified: true, text: GOOD, corrected: false });
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("bad output triggers ONE corrective retry carrying the feedback", async () => {
    const regenerate = vi.fn().mockResolvedValue({ ok: true, text: GOOD });
    const out = await verifyOrCorrect({ text: LEAKY, regenerate });
    expect(out).toEqual({ verified: true, text: GOOD, corrected: true });
    expect(regenerate).toHaveBeenCalledOnce();
    expect(String(regenerate.mock.calls[0]?.[0])).toContain("vendor_leak");
  });

  it("both attempts failing → unverified with reasons (caller degrades)", async () => {
    const regenerate = vi.fn().mockResolvedValue({ ok: true, text: LEAKY });
    const out = await verifyOrCorrect({ text: "too short", regenerate });
    expect(out.verified).toBe(false);
    if (!out.verified) expect(out.reasons.join()).toContain("vendor_leak");
    expect(regenerate).toHaveBeenCalledOnce(); // never loops
  });

  it("regeneration failure → unverified with the ORIGINAL reasons", async () => {
    const regenerate = vi.fn().mockResolvedValue({ ok: false });
    const out = await verifyOrCorrect({ text: LEAKY, regenerate });
    expect(out.verified).toBe(false);
    if (!out.verified) expect(out.reasons.join()).toContain("vendor_leak");
  });

  it("regeneration throwing → unverified, never rejects", async () => {
    const regenerate = vi.fn().mockRejectedValue(new Error("network"));
    const out = await verifyOrCorrect({ text: LEAKY, regenerate });
    expect(out.verified).toBe(false);
  });
});
