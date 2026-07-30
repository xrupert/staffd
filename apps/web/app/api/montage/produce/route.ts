/**
 * POST /api/montage/produce  (S3 — the Studio path)
 *
 * Owner-authed. Body: { script, title, tier }. Turns one scripted video
 * into a complete assembled render via the Montage Service: spec
 * generation → project → render job, recorded on the EXISTING
 * generation_jobs ledger (prediction_id = montage job id) so the webhook,
 * notifications (generation.ready), and polling all reuse the muapi
 * machinery unchanged.
 *
 * 503 montage_not_configured when the service env is absent — callers
 * fall back to the single-clip path (never a dead end).
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { getAdminToken, pbUrl } from "../../_lib/pb";
import { montageConfigured, createProject, startRenderProps } from "../../_lib/integrations/montage/client";
import { buildEditDecisions } from "../../_lib/montage/spec";
import { createJob, fingerprintFor } from "../../_lib/generation/jobs";

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

  const spec = buildEditDecisions(script, title);
  if (!spec) {
    return Response.json({ error: "script_unparseable", detail: "No Hook/Beat/CTA structure found." }, { status: 422 });
  }

  try {
    const projectId = await createProject(title);
    const jobId = await startRenderProps(projectId, spec);

    const pb = pbUrl();
    const token = await getAdminToken();
    const recordId = await createJob(pb, token, {
      user: me.id,
      kind: "video",
      model: "staffd-studio",
      prompt: `${title}\n\n${script.slice(0, 1500)}`,
      aspect_ratio: "9:16",
      prediction_id: jobId,
      fingerprint: fingerprintFor(me.id, "video", script, "9:16", jobId),
      tier,
      credit_weight: 0, // Studio cost accounting lands in S5 (unit-economics sheet)
    });

    if (!recordId) return Response.json({ error: "ledger_write_failed" }, { status: 500 });
    return Response.json({ ok: true, jobId: recordId, montageJob: jobId, projectId });
  } catch (err) {
    console.error("[montage.produce]", err);
    return Response.json({ error: "studio_unavailable" }, { status: 502 });
  }
}
