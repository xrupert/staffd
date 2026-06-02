/**
 * Phase 8 — Industry packs.
 *
 * Each pack is a curated set of vertical-specific specialists that the user
 * unlocks via a $19/mo Stripe add-on. Packs compose with the user's existing
 * unlocked departments — agents land inside their natural dept's roster
 * rather than carving out a new room.
 *
 * Adding a new pack:
 *   1. Create `packs/{slug}.ts` exporting `<name>Pack: AgentDef[]` and
 *      `<NAME>_PACK_META: IndustryPackMeta`.
 *   2. Add the pack id to the `IndustryPack` union in `../types.ts`.
 *   3. Re-export here + register in `ALL_PACKS`.
 *   4. Add a corresponding Stripe SKU in `apps/web/app/api/setup/stripe/route.ts`.
 *
 * The single-source-of-truth invariant from PR 15 holds: every pack agent
 * lives here in `packages/agents`, never in app code.
 */

import type { AgentDef, IndustryPack, IndustryPackMeta } from "../types";

import { lawPack, LAW_PACK_META } from "./law";
import { realEstatePack, REAL_ESTATE_PACK_META } from "./real-estate";
import { restaurantsPack, RESTAURANTS_PACK_META } from "./restaurants";
import { coachesPack, COACHES_PACK_META } from "./coaches";
import { tradesPack, TRADES_PACK_META } from "./trades";
import { salonsPack, SALONS_PACK_META } from "./salons";
import { agenciesPack, AGENCIES_PACK_META } from "./agencies";
import { consultantsPack, CONSULTANTS_PACK_META } from "./consultants";

export {
  lawPack, LAW_PACK_META,
  realEstatePack, REAL_ESTATE_PACK_META,
  restaurantsPack, RESTAURANTS_PACK_META,
  coachesPack, COACHES_PACK_META,
  tradesPack, TRADES_PACK_META,
  salonsPack, SALONS_PACK_META,
  agenciesPack, AGENCIES_PACK_META,
  consultantsPack, CONSULTANTS_PACK_META,
};

/** Full registry — every pack id → meta + agents. */
export const ALL_PACKS: ReadonlyArray<{
  meta: IndustryPackMeta;
  agents: AgentDef[];
}> = [
  { meta: LAW_PACK_META,         agents: lawPack },
  { meta: REAL_ESTATE_PACK_META, agents: realEstatePack },
  { meta: RESTAURANTS_PACK_META, agents: restaurantsPack },
  { meta: COACHES_PACK_META,     agents: coachesPack },
  { meta: TRADES_PACK_META,      agents: tradesPack },
  { meta: SALONS_PACK_META,      agents: salonsPack },
  { meta: AGENCIES_PACK_META,    agents: agenciesPack },
  { meta: CONSULTANTS_PACK_META, agents: consultantsPack },
];

/** Flat list of every packed agent across every pack. */
export const allPackAgents: AgentDef[] = ALL_PACKS.flatMap((p) => p.agents);

/** Pack ids list — useful for validation. */
export const PACK_IDS: ReadonlyArray<IndustryPack> = ALL_PACKS.map((p) => p.meta.id);

export function getPackMeta(id: string): IndustryPackMeta | undefined {
  return ALL_PACKS.find((p) => p.meta.id === id)?.meta;
}

export function getPackAgents(id: string): AgentDef[] {
  return ALL_PACKS.find((p) => p.meta.id === id)?.agents ?? [];
}
