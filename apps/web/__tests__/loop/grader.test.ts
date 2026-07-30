/**
 * PR-Loop-V1 (#2) — output grader: evidence-based verdicts, never
 * confidence-based. Deterministic checks only in v1.
 */

import { describe, it, expect } from "vitest";
import { gradeTaskOutput, graderRetryInstruction } from "../../app/api/_lib/loop/grader";

const GOOD =
  "Subject: Spring promotion launch\n\nHere is the complete campaign email draft for your review, including the subject line options and the call to action your customers will see.";

describe("gradeTaskOutput", () => {
  it("passes a real deliverable", () => {
    expect(gradeTaskOutput({ text: GOOD, isSystemTask: false })).toEqual({ pass: true });
  });

  it("rejects an empty / too-short artifact", () => {
    const v = gradeTaskOutput({ text: "  ok  ", isSystemTask: false });
    expect(v.pass).toBe(false);
    if (!v.pass) expect(v.reasons.join()).toContain("artifact_too_short");
  });

  it("rejects refusal-shaped output", () => {
    const v = gradeTaskOutput({
      text: "I'm sorry, but I cannot draft this campaign because the request lacks sufficient detail about the product.",
      isSystemTask: false,
    });
    expect(v.pass).toBe(false);
    if (!v.pass) expect(v.reasons.join()).toContain("refusal_shaped");
  });

  it("rejects error-shaped output", () => {
    const v = gradeTaskOutput({ text: '{"error":"upstream timeout while calling the model service"}', isSystemTask: false });
    expect(v.pass).toBe(false);
    if (!v.pass) expect(v.reasons.join()).toContain("error_shaped");
  });

  it("rejects vendor-name leaks (Model B3)", () => {
    const v = gradeTaskOutput({
      text: "Here is your TikTok script. I generated the visuals through Muapi and they are ready for your review today.",
      isSystemTask: false,
    });
    expect(v.pass).toBe(false);
    if (!v.pass) expect(v.reasons.join()).toContain("vendor_leak");
  });

  it("does not false-flag common words that happen to be vendor names", () => {
    const v = gradeTaskOutput({
      text: "Twenty of your customers responded to the paddle-board promotion, and the stripe pattern in the logo tested well with the focus group.",
      isSystemTask: false,
    });
    expect(v.pass).toBe(true);
  });

  it("never grades system/bus tasks", () => {
    expect(gradeTaskOutput({ text: "", isSystemTask: true })).toEqual({ pass: true });
  });

  it("collects multiple reasons at once", () => {
    const v = gradeTaskOutput({ text: "I'm sorry, I cannot.", isSystemTask: false });
    expect(v.pass).toBe(false);
    if (!v.pass) expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("graderRetryInstruction", () => {
  it("embeds the feedback and instructs silence about the review", () => {
    const s = graderRetryInstruction("vendor_leak: found \"muapi\"");
    expect(s).toContain("vendor_leak");
    expect(s).toContain("Do not mention this review");
  });
});
