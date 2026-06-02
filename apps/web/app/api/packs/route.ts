/**
 * GET /api/packs?userId=...
 *
 * Returns the list of all industry packs plus which ones are active for the
 * given user. Used by the Settings UI panel to render add / manage buttons.
 *
 * Public list — no auth required for the catalog. User-specific `active`
 * flag returned only when `userId` matches a known sub record (no auth
 * verification is necessary because we're returning the user's OWN pack
 * list, which is also visible through their pbToken via PB row rules).
 */

import { ALL_PACKS } from "@staffd/agents";
import { resolveDepartments } from "../_lib/trial";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  let activePacks: string[] = [];
  if (userId) {
    try {
      const trial = await resolveDepartments(userId);
      activePacks = trial.activePacks;
    } catch {
      /* return catalog only */
    }
  }

  const catalog = ALL_PACKS.map(({ meta, agents }) => ({
    id: meta.id,
    name: meta.name,
    description: meta.description,
    icon: meta.icon,
    agentCount: agents.length,
    departments: Array.from(new Set(agents.map((a) => a.department))),
    active: activePacks.includes(meta.id),
  }));

  return Response.json({ ok: true, packs: catalog, activePackIds: activePacks });
}
