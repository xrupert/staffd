/**
 * W91.5 — STAFFD self-knowledge: parse the canonical STAFFD_SELF.md (repo
 * root) into the Vault shape so the operator's specialists silently know
 * STAFFD's own brand identity. Canonical source wins over any businesses row.
 *
 * Minimal frontmatter parser (no new YAML dependency — Standard #20): handles
 * `key: "value"` scalars and `- "item"` arrays, which is all STAFFD_SELF.md
 * uses. Parse failure returns null → the loader falls through to the normal
 * customer path (fail-closed, never crashes).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Vault } from "./index";

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse STAFFD_SELF.md frontmatter into a Vault. Returns null on no frontmatter. */
export function parseStaffdSelf(md: string): Vault | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md ?? "");
  if (!m) return null;
  const body = m[1] ?? "";

  const scalars: Record<string, string> = {};
  const arrays: Record<string, string[]> = {};
  let currentArrayKey: string | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const arrayItem = /^\s+-\s+(.*)$/.exec(line);
    if (arrayItem && currentArrayKey) {
      arrays[currentArrayKey]!.push(unquote(arrayItem[1] ?? ""));
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const val = kv[2] ?? "";
    if (val === "") {
      // Either an empty scalar or the header of an array block.
      currentArrayKey = key;
      arrays[key] = [];
      scalars[key] = "";
    } else {
      currentArrayKey = null;
      scalars[key] = unquote(val);
    }
  }

  const num = (s: string | undefined) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const joinArr = (k: string) => (arrays[k]?.length ? arrays[k]!.join("; ") : undefined);

  const vault: Vault = {
    business_name: scalars.business_name || "STAFFD",
    industry: scalars.industry,
    description: scalars.description,
    target_audience: scalars.target_audience,
    brand_voice: scalars.brand_voice,
    brand_tone: scalars.brand_tone,
    brand_visuals: scalars.brand_visuals,
    messaging_pillars: joinArr("messaging_pillars"),
    hard_nos: joinArr("hard_nos"),
    customer_profile: scalars.customer_profile,
    positioning: scalars.positioning,
    service_area: scalars.service_area,
    avg_ticket: scalars.average_ticket,          // YAML average_ticket → Vault avg_ticket
    lead_sources: scalars.lead_sources,
    seasonality: scalars.seasonality_capacity,    // YAML seasonality_capacity → Vault seasonality
    review_count: num(scalars.review_count),
    review_rating: num(scalars.review_rating),
    review_platform: scalars.review_platform || undefined,
  };
  return vault;
}

// Cache the parse for the process lifetime (canonical file doesn't change at
// runtime). null = parse/read failed → customer path.
let cached: { v: Vault | null } | null = null;

/** Candidate paths to the repo-root STAFFD_SELF.md across run contexts. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "STAFFD_SELF.md"),
    path.join(cwd, "..", "..", "STAFFD_SELF.md"),
    path.join(cwd, "..", "STAFFD_SELF.md"),
    path.join(process.cwd(), "apps", "..", "STAFFD_SELF.md"),
  ];
}

/** The STAFFD self Vault, parsed from STAFFD_SELF.md (cached). null on failure. */
export function staffdSelfVault(): Vault | null {
  if (cached) return cached.v;
  for (const p of candidatePaths()) {
    try {
      const md = readFileSync(p, "utf8");
      const v = parseStaffdSelf(md);
      if (v) { cached = { v }; return v; }
    } catch {
      // try next candidate
    }
  }
  cached = { v: null };
  return null;
}

/** Test hook — reset the module cache. */
export function _clearStaffdSelfCache(): void {
  cached = null;
}
