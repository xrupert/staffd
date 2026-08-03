/**
 * POST /api/montage/produce  (S3 — the Studio path)
 *
 * Owner-authed. Body: { script, title, tier }. Delegates to the shared
 * produce-core (also used by the campaign runner's scheduled worker):
 * vault outro → spec → project → render job on the generation_jobs
 * ledger. 503 montage_not_configured when the service env is absent —
 * callers fall back to the single-clip path (never a dead end).
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { montageConfigured } from "../../_lib/integrations/montage/client";
import { produceStudioVideo } from "../../_lib/montage/produce-core";

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!montageConfigured()) {
    return Response.json({ error: "montage_not_configured" }, { status: 503 });
  }

  let body: { script?: unknown; title?: unknown; tier?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const script = String(body.script ?? "").trim();
  const title = String(body.title ?? "Your video").trim().slice(0, 120);
  const tier = String(body.tier ?? "pro");
  if (script.length < 20) return Response.json({ error: "script_required" }, { status: 400 });

  const result = await produceStudioVideo({ userId: me.id, script, title, tier });
  if (!result.ok) {
    if (result.error === "script_unparseable") {
      return Response.json({ error: "script_unparseable", detail: "No Hook/Beat/CTA structure found." }, { status: 422 });
    }
    return Response.json({ error: result.error }, { status: result.error === "studio_unavailable" ? 502 : 500 });
  }
  return Response.json({ ok: true, jobId: result.ledgerId, montageJob: result.montageJob, projectId: result.projectId });
}
