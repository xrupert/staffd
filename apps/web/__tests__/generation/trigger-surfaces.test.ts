/**
 * W95.7.3d-h2 — the ENFORCED INVARIANT: every generation trigger passes a tier
 * gate (Standard #38). This is the durable value of h2 — not the inline UX, but
 * a CI guard that makes "no ungated generation" a mechanical property, so the
 * pre-Tranche-1 F5/F6 class (a trigger that submitted to Muapi with no tier
 * confirmation) cannot recur when a future tranche (e.g. the L4 workflow
 * planner) adds a new generation trigger.
 *
 * The guard: the ONLY way `runGeneration(` may appear at a call site under app/
 * or lib/ is if that file is a declared surface in GENERATION_TRIGGER_SURFACES,
 * and that file references the tier-gate component the registry pairs it with.
 * Add an ungated 4th trigger → this test fails until you register + gate it.
 *
 * Limit (documented honestly): source-grep proves the gate component is
 * *referenced* in the file, not that it dominates the call at runtime. The
 * runtime guarantee comes from the muapi route pre-flight + the modal/inline
 * confirm tests; this guard forces every new trigger through that conscious
 * register-and-gate step rather than slipping in unnoticed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { GENERATION_TRIGGER_SURFACES } from "../../app/api/_lib/generation/trigger-surfaces";

const webRoot = resolve(__dirname, "..", "..");

// The shared driver that DEFINES runGeneration — not a trigger surface itself.
const DRIVER = join("lib", "generation-client.ts");

// A "call site" = `runGeneration(` not immediately preceded by `function `.
const CALL = /(?<!function )\brunGeneration\s*\(/;

function findCallSites(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__" || e.name === "node_modules" || e.name === ".next") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const rel = full.slice(webRoot.length + 1);
      if (rel === DRIVER) continue; // definition home, excluded by design
      if (CALL.test(readFileSync(full, "utf8"))) hits.push(rel.split(sep).join("/"));
    }
  };
  walk(resolve(webRoot, "app"));
  walk(resolve(webRoot, "lib"));
  return hits.sort();
}

describe("W95.7.3d-h2 — generation trigger-surface invariant (Standard #38)", () => {
  it("every runGeneration call site is a DECLARED surface in the registry", () => {
    const callSites = findCallSites();
    const declared = GENERATION_TRIGGER_SURFACES.map((s) => s.file).sort();
    expect(callSites, `undeclared generation trigger(s):\n${callSites.filter((f) => !declared.includes(f)).join("\n")}`)
      .toEqual(declared);
  });

  it("every declared surface file exists, still calls runGeneration, and references its tier gate", () => {
    for (const s of GENERATION_TRIGGER_SURFACES) {
      const src = readFileSync(resolve(webRoot, s.file), "utf8");
      expect(CALL.test(src), `${s.file} no longer calls runGeneration — stale registry entry`).toBe(true);
      expect(src.includes(s.gate), `${s.file} must reference its tier gate ${s.gate}`).toBe(true);
    }
  });

  it("declares at least one surface and pairs each with a known tier-gate component", () => {
    expect(GENERATION_TRIGGER_SURFACES.length).toBeGreaterThan(0);
    const knownGates = new Set(["GenerationTierModal", "GenerationTierInline"]);
    for (const s of GENERATION_TRIGGER_SURFACES) expect(knownGates.has(s.gate)).toBe(true);
  });
});
