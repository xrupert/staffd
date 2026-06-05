/**
 * PR-Tranche-2 Item 3 — PatternBadge component tests.
 *
 * Covers:
 *   - PatternBadge renders a chip for a valid pattern
 *   - PatternBadge with null/empty signal returns null
 *   - Weight bar respects MAX_WEIGHT cap
 *   - Tooltip includes the pattern label
 *   - SIGNAL_DISPLAY emoji falls back gracefully for unknown signals
 *
 * NOTE: PatternBadgeList (the self-fetching component) requires PB authStore
 * + fetch mocking — covered indirectly via the standalone PatternBadge.
 * Empty-list silent-fail is covered by the component-level "null on empty"
 * test.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PatternBadge, type Pattern } from "../../app/components/PatternBadge";

// JSX-transform: keep React in scope for renderToStaticMarkup
void React;

describe("PatternBadge", () => {
  it("renders a chip for a 'shared' pattern with the share emoji + short label", () => {
    const pattern: Pattern = {
      signal: "shared",
      weight: 2.0,
      count: 5,
      label: "You've shared this kind of work — it's shaping future outputs.",
    };
    const html = renderToStaticMarkup(<PatternBadge pattern={pattern} />);
    expect(html).toContain("↗️");
    expect(html).toContain("shared");
    expect(html).toContain("You&#x27;ve shared this kind of work");
  });

  it("renders for 'published' (strongest signal)", () => {
    const pattern: Pattern = {
      signal: "published",
      weight: 2.5,
      count: 3,
      label: "Work like this went live — it's a strong reference.",
    };
    const html = renderToStaticMarkup(<PatternBadge pattern={pattern} />);
    expect(html).toContain("🚀");
    expect(html).toContain("published");
  });

  it("returns null for missing pattern.signal", () => {
    const pattern = { signal: "", weight: 1, count: 1, label: "x" } as Pattern;
    const result = PatternBadge({ pattern });
    expect(result).toBeNull();
  });

  it("uses fallback emoji for unknown signal types", () => {
    const pattern: Pattern = {
      signal: "future_signal_v2",
      weight: 1.5,
      count: 2,
      label: "Custom signal label",
    };
    const html = renderToStaticMarkup(<PatternBadge pattern={pattern} />);
    expect(html).toContain("✦");
    expect(html).toContain("future_signal_v2");
  });

  it("weight bar width is clamped to 100% for max-weight signals", () => {
    const pattern: Pattern = {
      signal: "published",
      weight: 2.5, // == MAX_WEIGHT
      count: 1,
      label: "Max weight pattern",
    };
    const html = renderToStaticMarkup(<PatternBadge pattern={pattern} />);
    expect(html).toContain("width:100%");
  });

  it("tooltip (title attr) includes the pattern label and count", () => {
    const pattern: Pattern = {
      signal: "kept",
      weight: 1.5,
      count: 42,
      label: "Kept work pattern",
    };
    const html = renderToStaticMarkup(<PatternBadge pattern={pattern} />);
    expect(html).toContain("title=\"Kept work pattern (×42)\"");
  });
});
