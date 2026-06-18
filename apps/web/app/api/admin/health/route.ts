/**
 * GET /api/admin/health (W95.7) — V1 substrate health report. Super-admin gated.
 *
 * One call answers "is V1 healthy?": every expected collection present, every
 * intent wired to a commit handler, every worker registered, every migration
 * applied, every recipe in sync, and which vendor backends are configured.
 * Pollable by external monitoring. The heavy lifting is the pure
 * `buildHealthReport`; this route just wires the canonical registries + a
 * single PB collections probe.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";
import { buildHealthReport } from "../../_lib/admin/health";
import { EXPECTED_COLLECTIONS } from "../../_lib/security/row-rules";
import { MIGRATION_REGISTRY } from "../../_lib/admin/migrations";
import { COMMIT_HANDLERS } from "../../_lib/intent/commit-handlers";
import { WORKER_HANDLERS } from "../../_lib/worker/handlers";
import { SECOND_WORKER } from "../../workflows/[id]/[action]/route";
import { TwentyClient } from "../../_lib/integrations/twenty/client";
import { ListmonkClient } from "../../_lib/integrations/listmonk/client";
import { ChatwootClient } from "../../_lib/integrations/chatwoot/client";
import { DocusealClient } from "../../_lib/integrations/docuseal/client";
import { PlausibleClient } from "../../_lib/integrations/plausible/client";

type ColDef = { name: string; fields?: { name: string }[] };

export async function GET(req: Request) {
  try { await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "PocketBase not configured" }, { status: 503 }); }
  const pb = pbUrl();

  // One probe: every collection definition (name + fields). Drives both the
  // collections health and the migration-applied status (detectField).
  let defs: ColDef[] = [];
  try {
    const res = await fetch(`${pb}/api/collections?perPage=500&fields=name,fields`, { headers: { Authorization: token } });
    if (res.ok) defs = ((await res.json()) as { items?: ColDef[] }).items ?? [];
  } catch { /* defs stays [] → everything reads as missing (honest red) */ }

  const byName = new Map(defs.map((d) => [d.name, d]));
  const foundCollections = defs.map((d) => d.name);

  const migrations = MIGRATION_REGISTRY.map((m) => {
    const def = byName.get(m.collection);
    const applied = !!def && (!m.detectField || (def.fields ?? []).some((f) => f.name === m.detectField));
    return { route: m.route, applied };
  });

  const vendorConfigured: Record<string, boolean> = {
    twenty: TwentyClient.configured,
    listmonk: ListmonkClient.configured,
    chatwoot: ChatwootClient.configured,
    docuseal: DocusealClient.configured,
    plausible: PlausibleClient.configured,
  };

  const report = buildHealthReport({
    expectedCollections: EXPECTED_COLLECTIONS.map((e) => e.name),
    foundCollections,
    commitHandlers: Object.keys(COMMIT_HANDLERS),
    workerHandlers: Object.keys(WORKER_HANDLERS),
    recipeIds: Object.keys(SECOND_WORKER),
    vendorConfigured,
    migrations,
  });

  return Response.json({ ...report, generatedAt: new Date().toISOString() });
}
