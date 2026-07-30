/**
 * POST /api/webhooks/montage  (S3)
 *
 * Completion webhook from the Montage Service. Verifies the HMAC-SHA256
 * `x-montage-signature` over the raw body (fail-closed: 503 when
 * MONTAGE_WEBHOOK_SECRET is unset, 401 on mismatch), resolves the
 * generation_jobs row by montage job id (prediction_id), and completes or
 * fails it — which fires the existing generation.ready / generation.failed
 * notifications. The customer-facing result URL is STAFFD's own authed
 * proxy (/api/montage/output/[id]) — the vendor stays invisible.
 */

import crypto from "node:crypto";
import { getAdminToken, pbUrl } from "../../_lib/pb";
import { getJobByPrediction, completeJob, failJob } from "../../_lib/generation/jobs";

export async function POST(req: Request) {
  const secret = process.env.MONTAGE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook_not_configured" }, { status: 503 });

  const raw = await req.text();
  const given = req.headers.get("x-montage-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: { job_id?: string; status?: string };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return Response.json({ error: "unparseable_payload" }, { status: 400 });
  }
  const montageJob = String(payload.job_id ?? "");
  if (!montageJob) return Response.json({ ok: true, skipped: "no_job_id" });

  const pb = pbUrl();
  const token = await getAdminToken();
  const job = await getJobByPrediction(pb, token, montageJob);
  if (!job) return Response.json({ ok: true, skipped: "unknown_job" });

  if (payload.status === "succeeded") {
    await completeJob(pb, token, job, `/api/montage/output/${encodeURIComponent(montageJob)}`, null);
  } else {
    await failJob(pb, token, job, "studio_render_failed");
  }
  return Response.json({ ok: true });
}
