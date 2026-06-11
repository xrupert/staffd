/**
 * W58.2 Tests 3–6 — bridging wiring across the remaining trial-state
 * callers (static source pins).
 *
 * Full route-level tests for the agent route, orchestrator handlers,
 * morning brief, and worker would require heavy LLM/stream mocking; the
 * bridging behavior itself is pinned at the trial.ts layer
 * (trial-bridging.test.ts) and the resolver layer (routetask-industry
 * package suite). What W58.2 adds at these sites is pure pass-through —
 * pinned here by asserting each caller passes vaultIndustry (and the
 * worker threads activePacks into its default-agent resolution).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const API = join(__dirname, "..", "..", "app", "api");

function src(...parts: string[]): string {
  return readFileSync(join(API, ...parts), "utf8");
}

describe("W58.2 — vaultIndustry pass-through wiring", () => {
  const CALLERS: Array<[string, string[]]> = [
    ["agent route (Test 3)",            ["agent", "route.ts"]],
    ["orchestrator route handler",      ["_lib", "orchestrator", "handlers", "route.ts"]],
    ["orchestrator handoff (Test 5)",   ["_lib", "orchestrator", "handlers", "handoff.ts"]],
    ["orchestrator synthesize (Test 5)",["_lib", "orchestrator", "handlers", "synthesize.ts"]],
    ["morning brief (Test 4)",          ["_lib", "vault", "morning-brief.ts"]],
    ["trial endpoint",                  ["trial", "route.ts"]],
    ["roster endpoint",                 ["agents", "[department]", "route.ts"]],
    ["packs endpoint",                  ["packs", "route.ts"]],
    ["scheduled worker (Test 6)",       ["worker", "scheduled", "route.ts"]],
  ];

  for (const [label, path] of CALLERS) {
    it(`${label} passes vaultIndustry to resolveDepartments`, () => {
      const source = src(...path);
      expect(source, `${label} missing vaultIndustry`).toContain("vaultIndustry");
      // Every resolveDepartments call in the file carries the opts object.
      const bareCalls = source.match(/resolveDepartments\((?:[^,)]+)\)/g) ?? [];
      expect(bareCalls, `${label} still has a bare resolveDepartments(userId) call: ${bareCalls.join(" | ")}`).toHaveLength(0);
    });
  }

  it("morning brief bridges BOTH resolveDepartments sites", () => {
    const source = src("_lib", "vault", "morning-brief.ts");
    const calls = source.match(/resolveDepartments\(/g) ?? [];
    const bridged = source.match(/resolveDepartments\([^)]*vaultIndustry/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(bridged.length).toBe(calls.length);
  });

  it("worker threads activePacks into its default-agent resolution (Test 6)", () => {
    const source = src("worker", "scheduled", "route.ts");
    expect(source).toContain("getDepartmentDefaultAgent(department, activePacks)");
    expect(source).toContain("resolveDepartments(item.user");
  });
});
