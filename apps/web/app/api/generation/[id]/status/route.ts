/**
 * GET /api/generation/<id>/status (W95.7.3b) — client-polled status for an
 * async image/video generation job. Owner-scoped (whoAmI). Mirrors the W95.3.5
 * document-extraction poll. On each poll of a pending job it does ONE fast
 * (<1s) Muapi check; on completion it charges the credit exactly once
 * (claim-first, in completeJob) and stores the URL. Idempotent: re-polls after
 * completion never re-charge.
 */

import { getAdminToken, pbUrl } from "../../../_lib/pb";
import { whoAmI } from "../../../_lib/integrations/identity";
import { trySuperAdminByUserId } from "../../../_lib/auth/super-admin";
import { checkPrediction } from "../../../_lib/integrations/muapi/predictions";
import { getJob, completeJob, failJob } from "../../../_lib/generation/jobs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!id) return Response.json({ error: "missing_job_id" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const job = await getJob(pb, token, id);
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });
  if (job.user !== me.id) return Response.json({ error: "not_found" }, { status: 404 }); // own jobs only

  // Terminal states — return stored result, no Muapi call, no re-charge.
  if (job.status === "completed" && job.output_url) {
    return Response.json({ status: "completed", url: job.output_url, kind: job.kind });
  }
  if (job.status === "failed") {
    return Response.json({ status: "failed", error: job.error ?? "Generation failed", kind: job.kind });
  }

  // Pending without a prediction id can't be polled upstream — stay pending.
  if (!job.prediction_id) return Response.json({ status: "pending", kind: job.kind });

  const result = await checkPrediction(job.prediction_id);
  if (result.state === "completed") {
    const superAdmin = await trySuperAdminByUserId(job.user); // bypass credits for the operator
    const done = await completeJob(pb, token, job, result.url, superAdmin);
    return Response.json({ status: "completed", url: done.url, kind: job.kind, remaining: done.remaining, ...(done.creditWarning ? { creditWarning: done.creditWarning } : {}) });
  }
  if (result.state === "failed") {
    await failJob(pb, token, id, result.error);
    return Response.json({ status: "failed", error: result.error, kind: job.kind });
  }
  return Response.json({ status: "pending", kind: job.kind });
}
