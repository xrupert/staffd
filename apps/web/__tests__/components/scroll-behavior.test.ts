/**
 * W68 — Scroll behavior pins: anchor at top of new response, no auto-follow.
 *
 * Two layers:
 *   1. Unit contract on `anchorTopIfBelowViewport` (the one named scroll
 *      pattern STAFFD uses) — fires once with locked options ONLY when the
 *      element starts below the viewport.
 *   2. Static source pins per surface — the five CC auto-scroll calls, the
 *      DeptRoom/CEOBriefing/AgentPage per-chunk follows, and any
 *      `block:"end"` jump are gone; each surface anchors exactly once at
 *      generation start via the shared util. Visual behavior verification
 *      is operator-side smoke (per the W68 brief).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { anchorTopIfBelowViewport } from "../../lib/scroll";

const COMPONENTS = join(__dirname, "..", "..", "app", "components");

function fakeElement(top: number) {
  const scrollIntoView = vi.fn();
  return {
    el: {
      getBoundingClientRect: () => ({ top }),
      scrollIntoView,
    } as unknown as HTMLElement,
    scrollIntoView,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("anchorTopIfBelowViewport — utility contract (W68 Decisions 2/3/7)", () => {
  it("element below viewport → scrollIntoView once, instant, block:'start'", () => {
    vi.stubGlobal("innerHeight", 800);
    const { el, scrollIntoView } = fakeElement(900);
    anchorTopIfBelowViewport(el);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("element already visible → no scroll (Decision 3)", () => {
    vi.stubGlobal("innerHeight", 800);
    const { el, scrollIntoView } = fakeElement(400);
    anchorTopIfBelowViewport(el);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("element above viewport (user reading history) → no scroll (Decision 3)", () => {
    vi.stubGlobal("innerHeight", 800);
    const { el, scrollIntoView } = fakeElement(-200);
    anchorTopIfBelowViewport(el);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("null element → no throw, no call (defensive)", () => {
    expect(() => anchorTopIfBelowViewport(null)).not.toThrow();
  });

  it("layout API failure → swallowed, never throws over a scroll", () => {
    const el = {
      getBoundingClientRect: () => { throw new Error("detached"); },
      scrollIntoView: vi.fn(),
    } as unknown as HTMLElement;
    expect(() => anchorTopIfBelowViewport(el)).not.toThrow();
  });
});

describe("per-surface source pins (W68 Decisions 9–12)", () => {
  const read = (name: string) => readFileSync(join(COMPONENTS, name), "utf8");

  it("CommandCenter: zero raw scrollIntoView / scrollToBottom; anchors via the shared util", () => {
    const src = read("CommandCenter.tsx");
    expect(src).not.toContain("scrollToBottom");
    expect(src).not.toMatch(/scrollIntoView\(\{ behavior: "smooth"/);
    expect(src).not.toMatch(/block:\s*"end"/);
    // Exactly one anchor helper, called at both generation-start sites.
    expect(src).toContain("anchorTopIfBelowViewport(responseStartRef.current)");
    expect((src.match(/anchorNewResponse\(\);/g) ?? []).length).toBe(2);
    // The newest response wrapper carries the anchor ref.
    expect(src).toContain("ref={i === messages.length - 1 ? responseStartRef : undefined}");
  });

  it("DepartmentRoom: per-chunk follow + block:'end' jump gone; single start anchor", () => {
    const src = read("DepartmentRoom.tsx");
    expect(src).not.toMatch(/scrollIntoView/);
    expect(src).not.toMatch(/block:\s*"end"/);
    expect((src.match(/anchorTopIfBelowViewport\(outputRef\.current\)/g) ?? []).length).toBe(1);
  });

  it("CEOBriefing: per-chunk follow gone; single start anchor", () => {
    const src = read("CEOBriefing.tsx");
    expect(src).not.toMatch(/scrollIntoView/);
    expect((src.match(/anchorTopIfBelowViewport\(outputRef\.current\)/g) ?? []).length).toBe(1);
  });

  it("AgentPage (dead code, fixed for consistency — SA G4): same pattern", () => {
    const src = read("AgentPage.tsx");
    expect(src).not.toMatch(/scrollIntoView/);
    expect((src.match(/anchorTopIfBelowViewport\(outputRef\.current\)/g) ?? []).length).toBe(1);
  });

  it("no post-stream / completion scroll remains on any surface (Decision 5)", () => {
    for (const name of ["CommandCenter.tsx", "DepartmentRoom.tsx", "CEOBriefing.tsx", "AgentPage.tsx"]) {
      const src = read(name);
      // The only allowed automatic scroll is the single named anchor util.
      const rawScrolls = (src.match(/scrollIntoView|scrollTop\s*=|scrollTo\(/g) ?? []).length;
      expect(rawScrolls, `${name} has a raw scroll call`).toBe(0);
    }
  });

  it("W63 affordances + T3.0 invariants undisturbed by the scroll surgery", () => {
    const cc = read("CommandCenter.tsx");
    expect(cc).toContain("<ActionAffordances");
    expect(cc).not.toMatch(/agent.{0,5}credit|credits remaining/i);
    const hp = read("HandoffPanel.tsx");
    expect(hp).toContain("<ActionAffordances");
    expect(hp).not.toMatch(/scrollIntoView/); // never had scroll code — stays that way
  });
});
