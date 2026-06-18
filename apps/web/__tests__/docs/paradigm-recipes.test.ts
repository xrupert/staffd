/**
 * W95.6.y — guards the PARADIGM.md "Recipe-driven workflow assembly" section
 * against drift: the documented recipe→worker table must match the actual
 * SECOND_WORKER map in the approve/cancel route.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..", "..", "..");
const paradigm = readFileSync(resolve(root, "docs/architecture/PARADIGM.md"), "utf8");
const routeSrc = readFileSync(resolve(__dirname, "../..", "app/api/workflows/[id]/[action]/route.ts"), "utf8");

describe("PARADIGM.md — Recipe-driven workflow assembly (W95.6.y)", () => {
  it("documents the recipe-driven assembly section", () => {
    expect(paradigm).toMatch(/###\s+Recipe-driven workflow assembly/);
    expect(paradigm).toMatch(/SECOND_WORKER/);
  });

  it("every recipe in the doc table maps to the same worker as the SECOND_WORKER source", () => {
    // Parse the const map: { reply_to_ticket: "chatwoot_send_worker", ... }
    const map = routeSrc.match(/SECOND_WORKER[^=]*=\s*{([^}]*)}/)![1]!;
    const pairs = [...map.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!] as const);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (const [recipe, worker] of pairs) {
      const row = new RegExp(`\\\`${recipe}\\\`\\s*\\|\\s*\\\`${worker}\\\``);
      expect(paradigm).toMatch(row);
    }
  });
});
