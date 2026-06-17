/**
 * W91.5 — STAFFD self-knowledge: the canonical brand identity injected as the
 * operator's Vault so STAFFD's specialists silently know STAFFD itself.
 *
 * fs-FREE by design. An earlier version read STAFFD_SELF.md at runtime via
 * node:fs; that import poisoned a shared serverless chunk and 500'd on Vercel
 * (it worked locally). The canonical content is embedded here as a string and
 * parsed at module load — no readFileSync, no path, bundler-safe.
 *
 * SYNC CONTRACT: the frontmatter below is the runtime mirror of the YAML
 * frontmatter in /STAFFD_SELF.md (repo root). STAFFD_SELF.md is the
 * human-editable canonical doc (ratified by SA); this constant is what ships.
 * If you edit one, edit the other. (BRAND_VOICE.md + ARCHITECTURE.md remain
 * the upstream sources both distill — see STAFFD_SELF.md notes.)
 */

import type { Vault } from "./index";

// ── Canonical frontmatter (mirror of /STAFFD_SELF.md) ────────────────────────
const SELF_FRONTMATTER = `---
business_name: "STAFFD"
industry: "Compound agentic business operating system — specialists organized as departments that owners direct, not operate"
description: "STAFFD staffs your business with specialists across Marketing, Sales, Legal, HR, Finance, Operations, Paid Media, Design, Reputation, and the CEO — on call the moment you hire them. The Vault compounds your business context so the work gets sharper over time."
target_audience: "SMB owners with roughly 1-10 employees — solopreneurs and small teams who need expert-level work across functions without expert-level headcount."
brand_voice: "Direct, confident, specific. You STAFF your business — it's a verb. You're the owner/employer; specialists are your employees on call; departments are your org chart; the CEO is your strategic advisor. You direct the work; specialists produce it."
brand_tone: "Like a sharp chief of staff giving a brief — no hedging, no 'we believe', no jargon. Specialists have names and roles, not 'capabilities'. The owner is the boss; talk to them like one."
brand_visuals: "LSU Purple #5B21E8 on near-black #09090F with steel grays. Logo is a 2x2 grid of blocks with a boxed D in the wordmark. Dark, premium, minimal."
messaging_pillars:
  - "You've been staffed — you direct a team of specialists, you don't operate software"
  - "SMBs deserve to compete — enterprise-grade capability without enterprise headcount or cost"
  - "The Vault is the moat — your business context compounds with every action, making your staff sharper over time"
  - "Compound execution, not a chatbot — specialists do real work end to end, they don't just answer questions"
hard_nos:
  - "Never leak vendor / backend names — the infrastructure is invisible to the customer"
  - "Never 'AI team', 'AI agents', 'bots', or 'modules' — we sell specialists and departments"
  - "Never 'subscribe' or 'upgrade' — you 'hire', 'staff up', 'add to payroll'"
  - "Never 'AI-powered', 'AI-generated', or 'output' — specialists 'write', 'draft', and 'produce work'"
customer_profile: "SMB owners running businesses with roughly 1-10 employees — solopreneurs and small teams who want a full org of specialists for less than the cost of one hire."
positioning: "The compound agentic business operating system for SMBs — a full organization of specialists you direct, with a Vault that compounds your context so every piece of work gets sharper over time."
service_area: "Global, online — delivered in-app as software."
average_ticket: "Starter $39/mo, Growth $79/mo, Pro $149/mo, Agency $450/mo; department add-on $29/mo; CEO add-on $49.99/mo."
lead_sources: "Demo-based selling, founder network, and inbound from the live product."
seasonality_capacity: "SaaS — no seasonality; capacity is software-elastic, specialists are always on call."
review_count: 0
review_rating: 0
review_platform: ""
---`;

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse STAFFD_SELF frontmatter into a Vault. Returns null on no frontmatter. */
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

  return {
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
    avg_ticket: scalars.average_ticket,          // average_ticket → avg_ticket
    lead_sources: scalars.lead_sources,
    seasonality: scalars.seasonality_capacity,    // seasonality_capacity → seasonality
    review_count: num(scalars.review_count),
    review_rating: num(scalars.review_rating),
    review_platform: scalars.review_platform || undefined,
  };
}

// Parsed once at module load. null only if the embedded constant is malformed.
let cached: { v: Vault | null } | null = null;

/** The STAFFD self Vault (cached). null on parse failure → customer path. */
export function staffdSelfVault(): Vault | null {
  if (!cached) cached = { v: parseStaffdSelf(SELF_FRONTMATTER) };
  return cached.v;
}

/** Test hook — reset the module cache. */
export function _clearStaffdSelfCache(): void {
  cached = null;
}
