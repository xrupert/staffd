/**
 * W69 — Direct execution source pins.
 *
 * Locks the four decisions that retire the confirm gate and add the
 * AbortController stop affordance:
 *   D1 — on READY parse, auto-execute immediately (no "Yes, run it" gate)
 *   D2 — routing transparency: "Department → Agent is on it…" coordinator msg
 *   D3 — AbortController per-request, wired to Stop button
 *   D4 — AbortError caught silently; phase resets to "idle", no error message
 *
 * CC is too stateful to mount in happy-dom; these use the established
 * source-pin pattern (W63/W64/W67).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const CC = readFileSync(
  join(__dirname, "..", "..", "app", "components", "CommandCenter.tsx"),
  "utf8",
);

// ── D1 — confirm gate retired ────────────────────────────────────────────────
describe("W69 D1 — confirm gate retired", () => {
  it("CONFIRM_WORDS constant is gone", () => {
    expect(CC).not.toContain("CONFIRM_WORDS");
  });

  it("pendingAction state is gone", () => {
    expect(CC).not.toContain("pendingAction");
  });

  it("setPendingAction is gone", () => {
    expect(CC).not.toContain("setPendingAction");
  });

  it("PendingAction interface is gone", () => {
    expect(CC).not.toContain("PendingAction");
  });

  it("'Yes, run it' confirm button is gone", () => {
    expect(CC).not.toContain("Yes, run it");
  });

  it("EXECUTE message injection code is gone (confirm path removed)", () => {
    // The EXECUTE:{...} message was injected by the old confirm branch.
    // The isExec render guard may remain; what must be gone is the injection.
    expect(CC).not.toContain("EXECUTE:${JSON.stringify");
  });
});

// ── D2 — routing transparency ────────────────────────────────────────────────
describe("W69 D2 — inline routing transparency", () => {
  it("routing transparency message uses DEPT_LABELS lookup for dept label", () => {
    expect(CC).toContain("DEPT_LABELS[action.department]");
  });

  it("agent label is derived from agentId by dropping the dept prefix and title-casing", () => {
    expect(CC).toContain('action.agentId.split("-").slice(1)');
    expect(CC).toContain("p.charAt(0).toUpperCase() + p.slice(1)");
  });

  it("routing transparency message template contains 'is on it' text", () => {
    expect(CC).toContain("is on it");
  });

  it("message and setPhase('generating') both appear in the READY parse block", () => {
    // Extract the W69 READY block by anchoring on the W69 D1 comment.
    const blockStart = CC.indexOf("W69 D1");
    const blockEnd = CC.indexOf("} else {\n        setPhase(\"idle\");", blockStart);
    const readyBlock = CC.slice(blockStart, blockEnd);
    expect(readyBlock).toContain("is on it");
    expect(readyBlock).toContain('setPhase("generating")');
    // Transparency message must come before setPhase in the block.
    expect(readyBlock.indexOf("is on it")).toBeLessThan(readyBlock.indexOf('setPhase("generating")'));
  });

  it("runAgent is called immediately after setPhase — no user input required", () => {
    // The READY parse block must contain setPhase("generating") followed by runAgent
    const readyBlock = CC.slice(CC.indexOf("W69 D1"), CC.indexOf("} else {\n        setPhase(\"idle\");", CC.indexOf("W69 D1")));
    expect(readyBlock).toContain('setPhase("generating")');
    expect(readyBlock).toContain("await runAgent(");
  });
});

// ── D3 — AbortController stop affordance ────────────────────────────────────
describe("W69 D3 — AbortController stop affordance", () => {
  it("abortRef useRef is declared at component level", () => {
    expect(CC).toContain("const abortRef = useRef<AbortController | null>(null)");
  });

  it("AbortController is constructed per runAgent invocation", () => {
    expect(CC).toContain("const controller = new AbortController()");
    expect(CC).toContain("abortRef.current = controller");
  });

  it("fetch signal is wired to the controller", () => {
    expect(CC).toContain("signal: controller.signal");
  });

  it("Stop button calls abort() on abortRef", () => {
    expect(CC).toContain("abortRef.current?.abort()");
  });

  it("Stop button is rendered in the footer", () => {
    expect(CC).toContain("Stop →");
  });

  it("Stop button is only shown during the generating phase", () => {
    // The Stop button should appear inside a phase === "generating" conditional
    const stopIdx = CC.indexOf("Stop →");
    const generatingCheckIdx = CC.lastIndexOf('phase === "generating"', stopIdx);
    expect(generatingCheckIdx).toBeGreaterThan(0);
    expect(stopIdx - generatingCheckIdx).toBeLessThan(500);
  });

  it("abortRef is nulled in finally — no stale ref across requests", () => {
    expect(CC).toContain("abortRef.current = null");
  });
});

// ── D4 — AbortError silent handling ─────────────────────────────────────────
describe("W69 D4 — AbortError silent handling", () => {
  it("AbortError is caught and handled without surfacing an error message", () => {
    expect(CC).toContain('err.name === "AbortError"');
  });

  it("on abort, phase resets to idle (not done)", () => {
    // After AbortError, setPhase("idle") must be called, not setPhase("done")
    const abortBlock = CC.slice(
      CC.indexOf('err.name === "AbortError"'),
      CC.indexOf("abortRef.current = null"),
    );
    expect(abortBlock).toContain("aborted = true");
  });

  it("on abort, the generation placeholder is removed from messages", () => {
    expect(CC).toContain("setMessages((prev) => prev.slice(0, -1))");
  });

  it("finally block early-returns on abort to skip handoff fetch", () => {
    expect(CC).toContain("if (aborted) { setPhase(\"idle\"); return; }");
  });
});
