export type { AgentDef, Department, VaultContext, IndustryPack, IndustryPackMeta } from "./types";
export { buildPrompt } from "./utils/buildPrompt";
export { STAFFD_BRAND_LAWS, applyBrandLawsToPrompt } from "./brand-laws";

export { marketingAgents } from "./departments/marketing";
export { salesAgents } from "./departments/sales";
export { legalAgents } from "./departments/legal";
export { hrAgents } from "./departments/hr";
export { financeAgents } from "./departments/finance";
export { operationsAgents } from "./departments/operations";
export { designAgents } from "./departments/design";
export { paidMediaAgents } from "./departments/paid-media";
export { reputationAgents } from "./departments/reputation";
export { ceoAgents } from "./departments/ceo";

// Phase 8 — pack exports (curated industry-vertical specialists)
export {
  ALL_PACKS,
  PACK_IDS,
  allPackAgents,
  getPackMeta,
  getPackAgents,
  lawPack, LAW_PACK_META,
  realEstatePack, REAL_ESTATE_PACK_META,
  restaurantsPack, RESTAURANTS_PACK_META,
  coachesPack, COACHES_PACK_META,
  tradesPack, TRADES_PACK_META,
  salonsPack, SALONS_PACK_META,
  agenciesPack, AGENCIES_PACK_META,
  consultantsPack, CONSULTANTS_PACK_META,
} from "./packs";

import { marketingAgents } from "./departments/marketing";
import { salesAgents } from "./departments/sales";
import { legalAgents } from "./departments/legal";
import { hrAgents } from "./departments/hr";
import { financeAgents } from "./departments/finance";
import { operationsAgents } from "./departments/operations";
import { designAgents } from "./departments/design";
import { paidMediaAgents } from "./departments/paid-media";
import { reputationAgents } from "./departments/reputation";
import { ceoAgents } from "./departments/ceo";
import { allPackAgents } from "./packs";
import { STAFFD_BRAND_LAWS, applyBrandLawsToPrompt } from "./brand-laws";
import type { AgentDef, Department } from "./types";

/**
 * Hotfix bundle A — every specialist's system prompt is auto-prepended with
 * STAFFD_BRAND_LAWS so the model can NEVER drift into generic behavior
 * (recommending SEMrush/Ahrefs, using "wheelhouse", etc.). Single source of
 * truth — specialists do not restate these rules.
 *
 * Per PR-Bundle-3-A (Path 1) — the per-prompt string transformation lives
 * in `brand-laws.ts` as `applyBrandLawsToPrompt`. This helper applies it
 * across the agent registry. Refactor-only: output identical to before.
 */
function applyBrandLaws(agents: AgentDef[]): AgentDef[] {
  return agents.map((a) => ({
    ...a,
    systemPrompt: applyBrandLawsToPrompt(a.systemPrompt ?? ""),
  }));
}

/** All agents across all departments + packs — flat list, brand-laws applied. */
export const allAgents: AgentDef[] = applyBrandLaws([
  ...marketingAgents,
  ...salesAgents,
  ...legalAgents,
  ...hrAgents,
  ...financeAgents,
  ...operationsAgents,
  ...designAgents,
  ...paidMediaAgents,
  ...reputationAgents,
  ...ceoAgents,
  // Phase 8 — packed agents joined into the global pool so `getAgent(id)`
  // resolves them; dept rosters filter them out unless `activePacks` is set.
  ...allPackAgents,
]);

/** Look up a single agent by id */
export function getAgent(id: string): AgentDef | undefined {
  return allAgents.find((a) => a.id === id);
}

/**
 * Get all agents for a department.
 *
 * By default returns ONLY generic (non-packed) agents so dept rosters stay
 * stable for users without any packs. When `opts.activePacks` is supplied,
 * packed agents matching one of those pack ids are appended.
 */
export function getDepartmentAgents(
  department: Department,
  opts?: { activePacks?: ReadonlyArray<string> }
): AgentDef[] {
  const base = allAgents.filter((a) => a.department === department && !a.pack);
  const active = opts?.activePacks;
  if (!active || active.length === 0) return base;
  const packed = allAgents.filter(
    (a) => a.department === department && a.pack && active.includes(a.pack)
  );
  return [...base, ...packed];
}

/**
 * Default specialist per department — used as the fallback when /api/agent
 * is called without an explicit `agentId`. One source of truth for "the
 * canonical agent for this room" so we never have to maintain a parallel
 * `DEPT_SYSTEM_PROMPTS` map outside `packages/agents` again.
 */
export const DEPARTMENT_DEFAULT_AGENT_IDS: Record<Department, string> = {
  marketing:    "marketing-content-creator",
  sales:        "sales-outreach",
  legal:        "legal-document-drafter",
  hr:           "hr-job-posting-writer",
  finance:      "finance-invoice-generator",
  operations:   "operations-sop-writer",
  design:       "design-brand-guardian",
  "paid-media": "paid-media-auditor",
  reputation:   "reputation-customer-service-responder",
  ceo:          "ceo-chief-of-staff",
};

/**
 * Returns the canonical default agent for a department.
 *
 * Phase 8 — when `activePacks` is supplied AND a pack has a specialist in
 * the requested department, the packed agent wins over the generic one.
 * Resolution order within packs:
 *   1. Packed agent in this dept with `packDefault: true`
 *   2. Any packed agent in this dept (first match in pack order)
 *   3. Generic department default
 *
 * Falls back to marketing-content-creator for an unknown department so the
 * agent route always has a prompt to use.
 */
export function getDepartmentDefaultAgent(
  department: string,
  activePacks?: ReadonlyArray<string>
): AgentDef | undefined {
  if (activePacks && activePacks.length > 0) {
    // Explicit packDefault wins.
    for (const pack of activePacks) {
      const explicit = allAgents.find(
        (a) => a.department === department && a.pack === pack && a.packDefault === true
      );
      if (explicit) return explicit;
    }
    // Otherwise first packed agent in this dept by pack order.
    for (const pack of activePacks) {
      const anyPacked = allAgents.find(
        (a) => a.department === department && a.pack === pack
      );
      if (anyPacked) return anyPacked;
    }
  }
  const id = (DEPARTMENT_DEFAULT_AGENT_IDS as Record<string, string | undefined>)[department]
    ?? DEPARTMENT_DEFAULT_AGENT_IDS.marketing;
  return getAgent(id);
}

/**
 * Route a natural-language task to the most relevant agent
 * using keyword matching against agent tags.
 * Returns the best match or undefined if no tags match.
 */
export function routeTask(task: string, department?: Department): AgentDef | undefined {
  const pool = department ? getDepartmentAgents(department) : allAgents;
  const lowerTask = task.toLowerCase();

  let bestMatch: AgentDef | undefined;
  let bestScore = 0;

  for (const agent of pool) {
    const score = agent.tags.filter((tag) => lowerTask.includes(tag)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = agent;
    }
  }

  return bestMatch;
}

/** Starter pack: 6 curated agents for the Starter plan (per locked plan v1.0) */
export const STARTER_PACK_IDS = [
  "marketing-content-creator",
  "marketing-seo-specialist",
  "marketing-social-media-strategist",
  "sales-outreach",
  "reputation-customer-service-responder",
  "operations-document-generator",
] as const;

export const starterPackAgents: AgentDef[] = STARTER_PACK_IDS.map(
  (id) => allAgents.find((a) => a.id === id)!
);
