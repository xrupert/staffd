export type { AgentDef, Department, VaultContext } from "./types";
export { buildPrompt } from "./utils/buildPrompt";

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
import type { AgentDef, Department } from "./types";

/** All agents across all departments — flat list */
export const allAgents: AgentDef[] = [
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
];

/** Look up a single agent by id */
export function getAgent(id: string): AgentDef | undefined {
  return allAgents.find((a) => a.id === id);
}

/** Get all agents for a department */
export function getDepartmentAgents(department: Department): AgentDef[] {
  return allAgents.filter((a) => a.department === department);
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
