/**
 * GET /api/packs?userId=...
 *
 * Returns the list of all industry packs plus which ones are active for the
 * given user. Purely informational (W58.3) — packs activate automatically
 * via D-19 industry bridging; there is no purchase path.
 *
 * W58.3 (SA Decision 7) — the route loads the user's `businesses.industry`
 * via admin token and passes it to `resolveDepartments` so the `active`
 * flags reflect bridged state, not just legacy purchased packs. Single
 * extra PB read per request on a low-frequency endpoint.
 *
 * Public list — no auth required for the catalog. User-specific `active`
 * flag returned only when `userId` matches a known sub record (no auth
 * verification is necessary because we're returning the user's OWN pack
 * list, which is also visible through their pbToken via PB row rules).
 */

import { ALL_PACKS } from "@staffd/agents";
import { resolveDepartments } from "../_lib/trial";
import { getAdminToken, pbEscape, pbFirst } from "../_lib/pb";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  let activePacks: string[] = [];
  if (userId) {
    try {
      // W58.3 — read the business industry so bridging applies here too.
      let vaultIndustry: string | undefined;
      try {
        const token = await getAdminToken();
        const biz = await pbFirst<{ industry?: string }>(
          "businesses",
          `(user='${pbEscape(userId)}')`,
          token
        );
        vaultIndustry = biz?.industry;
      } catch {
        /* no industry — bridging silently skipped */
      }
      const trial = await resolveDepartments(userId, { vaultIndustry });
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
