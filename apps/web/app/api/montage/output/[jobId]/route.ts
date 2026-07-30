/**
 * GET /api/montage/output/[jobId]  (S3)
 *
 * Owner-authed proxy for a finished Studio render. The Montage Service's
 * own output endpoint requires the operator key; customers get their
 * video through THIS route only (ownership-checked against the
 * generation_jobs row) — Model B3, vendor invisible.
 */

import { whoAmI } from "../../../_lib/integrations/identity";
import { getAdminToken, pbUrl } from "../../../_lib/pb";
import { getJobByPrediction } from "../../../_lib/generation/jobs";
import { montageConfigured, fetchOutput } from "../../../_lib/integrations/montage/client";

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!montageConfigured()) return Response.json({ error: "montage_not_configured" }, { status: 503 });

  const { jobId } = await params;
  const pb = pbUrl();
  const token = await getAdminToken();
  const job = await getJobByPrediction(pb, token, jobId);
  if (!job || job.user !== me.id) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const upstream = await fetchOutput(jobId);
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "output_not_ready" }, { status: 404 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="your-video.mp4"`,
    },
  });
}
