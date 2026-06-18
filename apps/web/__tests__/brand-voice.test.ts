/**
 * W95.7 — brand-voice guard (CI-runnable). Customer-facing source must never
 * render a vendor brand name or a banned "AI-powered/agent/bot/generated"
 * phrase. Backends are invisible operator-shared infrastructure (Model B3);
 * customers see STAFFD + their specialists, never the tools underneath.
 *
 * Scope = what a non-super-admin user can see: /dashboard/** (minus /admin/**),
 * shared customer components, and the operations copy helpers. We scan rendered
 * source only — comment lines, import lines, and internal `/api/...` URL paths
 * are skipped (those are developer/plumbing text, never shown to the user).
 *
 * Admin surfaces are intentionally exempt: the operator knows what they run.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const webRoot = resolve(__dirname, "..");

/** Recursively collect .ts/.tsx files under `dir`, skipping any `/admin/` path. */
function walk(dir: string, acc: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "admin" || e.name === "node_modules") continue; // admin surfaces exempt
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Capitalized brand names (proper-noun forms that would appear in UI copy).
// Case-sensitive + word-boundary so ordinary English ("a plausible reason"),
// camelCase identifiers ("PlausibleScript", "resolvePlausibleDomain"), and
// SCREAMING env vars ("CHATWOOT_URL") never false-positive — only the brand
// spelling as a standalone word trips it.
const VENDOR_BRANDS = ["Twenty", "Listmonk", "Chatwoot", "Plausible", "Docuseal", "Muapi"];
const BRAND_RE = new RegExp(`\\b(${VENDOR_BRANDS.join("|")})\\b`);
const AI_PHRASES = /AI[-\s](powered|generated|agent|bot)s?/i;

// Admin-only components live under app/components/ but render solely on operator
// (super-admin) surfaces, where vendor names are allowed (dispatch: admin
// surfaces CAN use vendor names). Exempt them explicitly.
const ADMIN_ONLY_COMPONENTS = new Set([
  "IntegrationsHealthPanel.tsx", // operator integration health (admin page only)
  "BusinessPulseWidget.tsx",     // operator business pulse (admin page only)
]);

/** A line that is plumbing/comment, not rendered copy. */
function isSkippable(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("{/*") ||
    t.startsWith("import ") ||
    t.includes("/api/") // internal route URL, never shown to the user
  );
}

function customerFacingFiles(): string[] {
  return [
    ...walk(resolve(webRoot, "app/dashboard")),
    ...walk(resolve(webRoot, "app/components")),
    resolve(webRoot, "lib/operations.ts"),
  ].filter((f) => ![...ADMIN_ONLY_COMPONENTS].some((c) => f.endsWith(c)));
}

describe("brand-voice — no vendor names in customer-facing copy (W95.7)", () => {
  const files = customerFacingFiles();

  it("scans a non-trivial set of customer-facing files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("renders zero vendor brand names", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (isSkippable(line)) return;
        const m = BRAND_RE.exec(line);
        if (m) hits.push(`${file.replace(webRoot, "")}:${idx + 1} → "${m[1]}"`);
      });
    }
    expect(hits, `Vendor brand name leaked into customer-facing copy:\n${hits.join("\n")}`).toEqual([]);
  });

  it("renders zero banned AI phrases", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (isSkippable(line)) return;
        if (AI_PHRASES.test(line)) hits.push(`${file.replace(webRoot, "")}:${idx + 1}`);
      });
    }
    expect(hits, `Banned AI phrase in customer-facing copy:\n${hits.join("\n")}`).toEqual([]);
  });
});
