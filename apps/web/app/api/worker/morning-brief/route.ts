/**
 * GET /api/worker/morning-brief  — Phase 6 nightly Morning Brief worker.
 *
 * Vercel cron runs this once at 06:00 UTC (≈ 1 AM ET / 10 PM PT prev day).
 * For each user active in the last 7 days, compiles a Morning Brief with
 * per-department sections (CEO synthesis + Marketing drafts + Reputation
 * template + Sales follow-ups + Operations calendar) and writes one
 * vault_briefs row per (user, date).
 *
 * Idempotent: skips users who already have a brief for tomorrow's date.
 * Bounded concurrency (3) keeps Vercel function memory + upstream rate
 * limits safe at SMB scale.
 *
 * Manual trigger: `curl -H 'x-worker-secret: $WORKER_SECRET' \
 *   https://urstaffd.com/api/worker/morning-brief`
 */

import { generateBriefsForActiveUsers } from "../../_lib/vault/morning-brief";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";

  const validCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const validManual = workerSecret && workerHeader === workerSecret;
  if (!validCron && !validManual) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const tally = await generateBriefsForActiveUsers(7, 3);
  const durationMs = Date.now() - start;

  console.log(
    `[worker.morning-brief] scanned=${tally.scanned} ok=${tally.ok} skipped=${tally.skipped} failed=${tally.failed} in ${durationMs}ms`
  );

  // Rename tally.ok → generated in the response to avoid colliding with the
  // top-level `ok: true` success flag callers expect.
  return Response.json({
    ok: true,
    durationMs,
    scanned: tally.scanned,
    generated: tally.ok,
    skipped: tally.skipped,
    failed: tally.failed,
  });
}

export const POST = GET;
