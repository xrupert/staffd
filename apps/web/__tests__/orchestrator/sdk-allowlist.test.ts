/**
 * W61′ — Mechanical enforcement of ARCH §5's hard rule.
 *
 * 1. No `@anthropic-ai/sdk` import anywhere under
 *    `_lib/orchestrator/handlers/**` — handlers go through callLLM only
 *    (the "B1 grep test" the llm.ts header promised; now it exists).
 * 2. The SDK-instantiation allowlist: exactly the audited callsites from
 *    the W61 Phase A inventory may construct the Anthropic client. Any
 *    NEW direct callsite fails this suite — per ARCH §5, adding one
 *    requires explicit Senior Architect authorization (and then a
 *    deliberate edit to this allowlist alongside it).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const WEB_ROOT = join(__dirname, "..", "..");

/** The audited allowlist — W61 Phase A §A, SA-affirmed (W61′ ruling H1). */
const SDK_ALLOWLIST = new Set([
  "app/api/_lib/orchestrator/llm.ts",        // the guardrail wrapper
  "app/api/agent/route.ts",                  // specialist execution tier (§5, by design)
  "app/api/integrations/muapi/route.ts",     // generation tier distillation (§5, by design)
  "app/api/prefill/route.ts",                // §5 exemption 5
  "app/api/webhooks/chatwoot/route.ts",      // §5 exemption 4
  "app/api/worker/scheduled/route.ts",       // §5 exemption 3
  "app/api/_lib/vault/morning-brief.ts",     // §5 exemption 1
  "app/api/_lib/vault/summarize.ts",         // §5 exemption 2
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function isCodeLine(line: string): boolean {
  const t = line.trim();
  return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
}

describe("ARCH §5 hard rule — SDK allowlist (W61′)", () => {
  it("no @anthropic-ai/sdk import under _lib/orchestrator/handlers/**", () => {
    const handlersDir = join(WEB_ROOT, "app", "api", "_lib", "orchestrator", "handlers");
    for (const file of walk(handlersDir)) {
      const src = readFileSync(file, "utf8");
      expect(src, `${relative(WEB_ROOT, file)} imports the SDK directly`).not.toContain("@anthropic-ai/sdk");
    }
  });

  it("`new Anthropic(` appears ONLY in the audited allowlist", () => {
    const files = [...walk(join(WEB_ROOT, "app")), ...walk(join(WEB_ROOT, "lib"))];
    const offenders: string[] = [];
    const found = new Set<string>();

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("new Anthropic(")) continue;
      const hasCodeInstantiation = src
        .split("\n")
        .some((line) => line.includes("new Anthropic(") && isCodeLine(line));
      if (!hasCodeInstantiation) continue; // comment-only mention (e.g. lib/env.ts)

      const rel = relative(WEB_ROOT, file).replace(/\\/g, "/");
      found.add(rel);
      if (!SDK_ALLOWLIST.has(rel)) offenders.push(rel);
    }

    expect(
      offenders,
      `New direct Anthropic callsite(s) outside the ARCH §5 allowlist: ${offenders.join(", ")}. ` +
      `Direct calls require explicit Senior Architect authorization (ARCH §5 hard rule).`
    ).toHaveLength(0);

    // The allowlist itself stays honest — every allowlisted file still
    // instantiates (a removed callsite should be removed here too).
    for (const allowed of SDK_ALLOWLIST) {
      expect(found.has(allowed), `${allowed} no longer instantiates the SDK — prune the allowlist`).toBe(true);
    }
  });
});
