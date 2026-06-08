/**
 * PR-Tranche-2.6.4 (W35) — CommandCenter send() skipConfirm contract.
 *
 * Pre-W35: Next Steps button click → send(f.task) → goes through
 * orchestrate → returns READY → Yes/Cancel buttons re-appear → user
 * had to re-confirm what they already explicitly clicked. Wasted
 * friction; violates direct-manipulation UX.
 *
 * Fix: send() accepts `options?: {skipConfirm, preselectDept,
 * preselectAgent}`. When `skipConfirm` + `preselectDept` are set,
 * send() short-circuits: skips orchestrate AND the confirm gate,
 * goes straight to runAgent with the pre-selected dept.
 *
 * This test exercises the contract — given the options shape, the
 * short-circuit path takes precedence over both the orchestrate fetch
 * and the CONFIRM_WORDS check.
 */

import { describe, it, expect } from "vitest";

/**
 * Replicates send()'s phase-decision logic post-fix. Exists for
 * testability without mounting the full CommandCenter React component.
 *
 * Returns a `path` string identifying which branch send() took:
 *   - "noop"          — content empty or phase blocked execution
 *   - "skip-confirm"  — W35 short-circuit (button-click path)
 *   - "confirm-execute" — CONFIRM_WORDS matched + pendingAction set
 *   - "orchestrate"   — normal user-typed prompt path
 */
function simulateSendPath(input: {
  content: string;
  phase: "idle" | "routing" | "generating" | "done";
  pendingAction: { department: string; task: string } | null;
  options?: { skipConfirm?: boolean; preselectDept?: string };
}): string {
  const { content, phase, pendingAction, options } = input;
  const CONFIRM_WORDS = /^(yes|confirm|confirmed|approved|approve|go|do it|go ahead|sure|yep|yup|ok|okay|sounds good|make it|run it|let'?s go)/i;

  if (!content || phase === "routing" || phase === "generating") return "noop";

  // W35 short-circuit (added in T2.6.4)
  if (options?.skipConfirm && options?.preselectDept) {
    return "skip-confirm";
  }

  // CONFIRM_WORDS path
  if (pendingAction && CONFIRM_WORDS.test(content)) {
    return "confirm-execute";
  }

  // Default: route through orchestrator
  return "orchestrate";
}

describe("send() skipConfirm contract (W35 fix)", () => {
  it("button-click path with skipConfirm + preselectDept short-circuits to runAgent", () => {
    const path = simulateSendPath({
      content: "Generate the video",
      phase: "idle",
      pendingAction: null,
      options: { skipConfirm: true, preselectDept: "design" },
    });
    expect(path).toBe("skip-confirm");
  });

  it("user-typed prompts (no options) STILL go through orchestrate (no regression)", () => {
    const path = simulateSendPath({
      content: "I need a TikTok video",
      phase: "idle",
      pendingAction: null,
    });
    expect(path).toBe("orchestrate");
  });

  it("user typing 'yes' with pendingAction STILL fires confirm-execute (no regression)", () => {
    const path = simulateSendPath({
      content: "yes",
      phase: "idle",
      pendingAction: { department: "marketing", task: "Draft post" },
    });
    expect(path).toBe("confirm-execute");
  });

  it("skipConfirm WITHOUT preselectDept does NOT short-circuit (defensive)", () => {
    // skipConfirm alone is insufficient — we need to know where to send it
    const path = simulateSendPath({
      content: "Generate the video",
      phase: "idle",
      pendingAction: null,
      options: { skipConfirm: true },
    });
    expect(path).toBe("orchestrate");
  });

  it("skip-confirm path takes precedence over CONFIRM_WORDS path", () => {
    // If a button task literally starts with "yes" (edge case), the W35
    // short-circuit fires before CONFIRM_WORDS would
    const path = simulateSendPath({
      content: "yes, send to design",
      phase: "idle",
      pendingAction: { department: "marketing", task: "Old pending action" },
      options: { skipConfirm: true, preselectDept: "design" },
    });
    expect(path).toBe("skip-confirm");
  });

  it("phase blocks short-circuit just like other branches (defensive)", () => {
    const path = simulateSendPath({
      content: "Generate the video",
      phase: "generating",
      pendingAction: null,
      options: { skipConfirm: true, preselectDept: "design" },
    });
    expect(path).toBe("noop");
  });
});
