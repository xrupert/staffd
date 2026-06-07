/**
 * PR-Tranche-2.6.3 (W27 follow-up) — fallback copy discriminates
 * "fresh slate" (empty vault, normal new-user state) from "degraded"
 * (LLM/system failure when activity DID exist).
 *
 * Both code paths reach degradedFor() via the same callLLM-failure
 * trigger; the activitySamples emptiness is the signal that
 * distinguishes the two cases. Pre-fix, both produced the same
 * "Working from limited context" copy and misattributed the new-user
 * case as a system failure.
 */

import { describe, it, expect } from "vitest";
import { degradedFor } from "../../app/api/_lib/orchestrator/fallbacks";

describe("briefFallback empty-vault discrimination (W27 follow-up)", () => {
  it("returns fresh-slate copy when activitySamples is empty (new user)", () => {
    const result = degradedFor("brief", { activitySamples: [] });
    expect(result.task).toContain("fresh slate");
    expect(result.task).not.toContain("Working from limited context");
    // Welcoming, not apologetic
    expect(result.task).toContain("specialists");
    // Rationale matches
    expect(result.rationale).toContain("Welcoming new owner");
  });

  it("returns degradation copy when activitySamples has content (LLM failed but work exists)", () => {
    const result = degradedFor("brief", {
      activitySamples: [
        { department: "marketing", count: 3, samples: ["Draft a LinkedIn post"] },
      ],
    });
    expect(result.task).toContain("Working from limited context");
    expect(result.task).toContain("Activity snapshot");
    expect(result.task).toContain("Marketing");
    expect(result.rationale).toContain("limited context");
  });

  it("handles undefined activitySamples as fresh-slate (defensive)", () => {
    const result = degradedFor("brief", {});
    expect(result.task).toContain("fresh slate");
  });
});

describe("synthesizeFallback empty-vault discrimination (W27 follow-up)", () => {
  it("returns fresh-slate copy when no cross-department work yet", () => {
    const result = degradedFor("synthesize", { activitySamples: [] });
    expect(result.task).toContain("fresh slate");
    expect(result.task).not.toContain("Cross-department snapshot");
    // CEO-specific welcoming copy
    expect(result.task).toContain("CEO Strategist");
    expect(result.rationale).toContain("Welcoming new owner");
  });

  it("returns snapshot copy when cross-department work exists", () => {
    const result = degradedFor("synthesize", {
      activitySamples: [
        { department: "marketing", count: 2, samples: ["LinkedIn post"] },
        { department: "sales", count: 1, samples: ["Outreach sequence"] },
      ],
    });
    expect(result.task).toContain("Cross-department snapshot");
    expect(result.task).toContain("Marketing");
    expect(result.task).toContain("Sales");
    expect(result.rationale).toContain("limited context");
  });

  it("handles undefined activitySamples as fresh-slate", () => {
    const result = degradedFor("synthesize", {});
    expect(result.task).toContain("fresh slate");
  });
});

describe("routeFallback unchanged (W27 — true degradation only)", () => {
  it("still emits 'limited context' copy on LLM failure (route intent IS true degradation)", () => {
    const result = degradedFor("route", {
      message: "I need a tik tok video",
      unlockedDepts: ["marketing", "sales", "design"],
    });
    // routeFallback fires when callLLM itself failed — always a real
    // degradation; the empty-vault discriminator does NOT apply here.
    expect(result.rationale).toContain("limited context");
  });

  it("uses last-used-dept path when lastUsedDept is in unlocked set", () => {
    const result = degradedFor("route", {
      message: "x",
      unlockedDepts: ["marketing", "design"],
      lastUsedDept: "design",
    });
    expect(result.department).toBe("design");
    expect(result.rationale).toContain("Design desk");
  });
});
