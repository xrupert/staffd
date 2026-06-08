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

describe("routeFallback — neutral routing copy (W27.complete / W36)", () => {
  it("does NOT emit 'limited context' editorializing on degraded path (W27.complete)", () => {
    // Pre-T2.6.4 the copy editorialized about context state. That misattributed
    // the degraded path (often LLM going off-format on conversational queries,
    // NOT a vault issue) as a context degradation. Per W36 "agent wins on
    // contextuality" — orchestrator stays neutral; specialist's streamed
    // response carries any context acknowledgment.
    const result = degradedFor("route", {
      message: "I need a tik tok video",
      unlockedDepts: ["marketing", "sales", "design"],
    });
    expect(result.rationale).not.toContain("limited context");
    expect(result.rationale).not.toContain("Working from");
  });

  // PR-Tranche-2.6.5 (copy lock) — operator-approved single-form copy:
  // "Routing this to ${Dept} — they'll take it from here."
  // No "your", no "desk", no per-branch differentiation.
  it("emits operator-approved copy (default-dept path)", () => {
    const result = degradedFor("route", {
      message: "anything",
      unlockedDepts: ["marketing"],
    });
    expect(result.rationale).toBe("Routing this to Marketing — they'll take it from here.");
    expect(result.rationale).not.toContain("desk");
    expect(result.rationale).not.toContain("your");
  });

  it("uses last-used-dept path AND emits same canonical copy form", () => {
    const result = degradedFor("route", {
      message: "x",
      unlockedDepts: ["marketing", "design"],
      lastUsedDept: "design",
    });
    expect(result.department).toBe("design");
    expect(result.rationale).toBe("Routing this to Design — they'll take it from here.");
    expect(result.rationale).not.toContain("desk");
    expect(result.rationale).not.toContain("where you were just working");
    expect(result.rationale).not.toContain("limited context");
  });
});
