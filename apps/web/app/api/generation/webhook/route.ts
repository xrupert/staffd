/**
 * POST /api/generation/webhook (W95.7.3c-b1) — Muapi completion callback (push
 * delivery via `?webhook=`). PRIMARY completion path; the client poll
 * (GET /api/generation/[id]/status) stays as fallback.
 *
 * Auth: an HMAC-derived capability token in the URL (`?token=`), timing-safe
 * compared (Muapi's spec shows no payload signing). The body is NOT trusted —
 * we read only the prediction id from it, then pull the AUTHORITATIVE result
 * via checkPrediction and run the same claim-first charge as the poll path.
 * This closes the closed-tab margin leak (Muapi debits on completion; the
 * webhook lets us charge the customer for a generation they didn't wait for).
 *
 * Public route (no STAFFD session — Muapi is the caller). Returns 401 on a bad
 * token; 200 on a valid token for any other outcome (incl. unknown/terminal
 * jobs) so Muapi stops retrying.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { trySuperAdminByUserId } from "../../_lib/auth/super-admin";
import { verifyWebhookToken, checkPrediction } from "../../_lib/integrations/muapi/predictions";
import { getJobByPrediction, completeJob, failJob } from "../../_lib/generation/jobs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!verifyWebhookToken(url.searchParams.get("token"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => ({}))) as { id?: string; request_id?: string; prediction_id?: string };
  const predictionId = payload.request_id ?? payload.id ?? payload.prediction_id ?? "";
  if (!predictionId) return Response.json({ ok: true, ignored: "no prediction id" }); // ack — can't match

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const job = await getJobByPrediction(pb, token, predictionId);
  if (!job) return Response.json({ ok: true, ignored: "unknown job" });        // ack
  if (job.status !== "pending") return Response.json({ ok: true, idempotent: true }); // already terminal

  // Pull authoritative state — never trust the (unsigned) webhook body.
  const result = await checkPrediction(predictionId);
  if (result.state === "completed") {
    const superAdmin = await trySuperAdminByUserId(job.user);
    await completeJob(pb, token, job, result.url, superAdmin); // claim-first charge
    return Response.json({ ok: true, status: "completed" });
  }
  if (result.state === "failed") {
    await failJob(pb, token, job, result.error);
    return Response.json({ ok: true, status: "failed" });
  }
  return Response.json({ ok: true, status: "pending" }); // fired early — poll/next webhook resolves
}
