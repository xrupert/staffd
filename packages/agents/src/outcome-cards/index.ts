/**
 * W44 — Outcome card pool aggregator.
 *
 * Single source of truth for every outcome card across all 10 departments.
 * Downstream consumers: W43 department empty states, W45 pricing reframe,
 * landing page rewrite, demo page. Rotation/filtering logic is W43.1 —
 * this module only owns the pool and lookups.
 */

export type { OutcomeCard, OutcomeCardDepartment, OutcomeCardTag } from "./types";

import type { OutcomeCard, OutcomeCardDepartment } from "./types";

import { marketingOutcomeCards } from "./marketing";
import { salesOutcomeCards } from "./sales";
import { legalOutcomeCards } from "./legal";
import { hrOutcomeCards } from "./hr";
import { financeOutcomeCards } from "./finance";
import { operationsOutcomeCards } from "./operations";
import { paidMediaOutcomeCards } from "./paid-media";
import { designOutcomeCards } from "./design";
import { reputationOutcomeCards } from "./reputation";
import { ceoOutcomeCards } from "./ceo";

export {
  marketingOutcomeCards,
  salesOutcomeCards,
  legalOutcomeCards,
  hrOutcomeCards,
  financeOutcomeCards,
  operationsOutcomeCards,
  paidMediaOutcomeCards,
  designOutcomeCards,
  reputationOutcomeCards,
  ceoOutcomeCards,
};

/** The full pool — every card across all 10 departments. */
export const ALL_OUTCOME_CARDS: OutcomeCard[] = [
  ...marketingOutcomeCards,
  ...salesOutcomeCards,
  ...legalOutcomeCards,
  ...hrOutcomeCards,
  ...financeOutcomeCards,
  ...operationsOutcomeCards,
  ...paidMediaOutcomeCards,
  ...designOutcomeCards,
  ...reputationOutcomeCards,
  ...ceoOutcomeCards,
];

/** All cards for one department. */
export function getOutcomeCardsByDepartment(
  dept: OutcomeCardDepartment
): OutcomeCard[] {
  return ALL_OUTCOME_CARDS.filter((c) => c.department === dept);
}

/** Look up a single card by its stable id. */
export function getOutcomeCardById(id: string): OutcomeCard | undefined {
  return ALL_OUTCOME_CARDS.find((c) => c.id === id);
}
