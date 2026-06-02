/**
 * GET /api/worker/vault  — Vault ingestion worker.
 *
 * Vercel cron tick (every minute, `* / 1 * * * *` (every-minute)) drains up to `BATCH_SIZE`
 * pending rows from `vault_ingest_queue`. Per V4a spec:
 *
 *   • Claim ≤ 8 rows whose `next_run_at <= now`.
 *   • Run them with a bounded in-process concurrency of 4 (no p-limit dep —
 *     simple N-worker queue is plenty).
 *   • For each job:
 *       success     → `complete(rowId)`
 *       rate-limit  → `requeueNoIncrement(rowId, +60 s)` — attempts unchanged
 *       failure     → `fail(rowId, attempts, err)` — exponential backoff or
 *                     `dead` after 5 attempts
 *   • Returns a tally so cron logs / manual triggers can see what happened.
 *
 * Auth: `Bearer ${CRON_SECRET}` (Vercel cron) or `x-worker-secret: ${WORKER_SECRET}`
 * for manual / scripted runs. Matches the existing /api/worker/scheduled
 * security model.
 *
 * The worker dispatches by `kind`:
 *   • document     → `summarizeAndIndexDocument` (V3)
 *   • conversation → V4b will implement; today returns "not_implemented"
 *   • shard        → V4b
 *   • backfill     → V4b
 */

import { claim, complete, fail, requeueNoIncrement, type IngestRow } from "../../_lib/vault/queue";
import { RateLimitedError } from "../../_lib/vault/ratelimit";
import { runIngestJob } from "../../_lib/vault/ingest";

const BATCH_SIZE = 8;
const CONCURRENCY = 4;
const RATE_LIMIT_REQUEUE_DELAY_SEC = 60;

type JobOutcome = "completed" | "rate_limited" | "failed" | "dead" | "skipped";

/**
 * Bounded-concurrency runner — N async workers pull from a shared index
 * queue and call `fn` on each item. No external dep; behaves like p-limit
 * for our needs.
 */
async function runWithLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        try {
          results[i] = await fn(items[i]!);
        } catch (err) {
          // Should be unreachable — runAndSettle catches its own errors.
          results[i] = { outcome: "failed", reason: String(err) } as unknown as R;
        }
      }
    })
  );

  return results as R[];
}

/** Run a single queued job end-to-end and settle its row in the queue. */
async function runAndSettle(
  row: IngestRow
): Promise<{ outcome: JobOutcome; durationMs: number; reason?: string }> {
  const start = Date.now();
  try {
    const result = await runIngestJob(row);
    if (result.ok) {
      await complete(row.id);
      return {
        outcome: result.skipped ? "skipped" : "completed",
        durationMs: Date.now() - start,
        reason: result.reason,
      };
    }
    // Non-throw failure path — bump attempts / maybe dead.
    const { status } = await fail(row.id, row.attempts, result.reason ?? "unknown");
    return {
      outcome: status === "dead" ? "dead" : "failed",
      durationMs: Date.now() - start,
      reason: result.reason,
    };
  } catch (err) {
    if (err instanceof RateLimitedError) {
      await requeueNoIncrement(row.id, RATE_LIMIT_REQUEUE_DELAY_SEC);
      return {
        outcome: "rate_limited",
        durationMs: Date.now() - start,
        reason: `rate_limited:${err.provider}`,
      };
    }
    const { status } = await fail(row.id, row.attempts, String(err));
    return {
      outcome: status === "dead" ? "dead" : "failed",
      durationMs: Date.now() - start,
      reason: String(err),
    };
  }
}

export async function GET(req: Request) {
  // Auth — Vercel cron passes `authorization: Bearer ${CRON_SECRET}`; manual
  // triggers use the `x-worker-secret` header (same as /api/worker/scheduled).
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";

  const validCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const validManual = workerSecret && workerHeader === workerSecret;
  if (!validCron && !validManual) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const claimed = await claim(BATCH_SIZE);
  if (claimed.length === 0) {
    return Response.json({ ok: true, processed: 0, message: "queue empty" });
  }

  const settlements = await runWithLimit(claimed, CONCURRENCY, runAndSettle);

  const tally = {
    completed: 0,
    skipped: 0,
    rate_limited: 0,
    failed: 0,
    dead: 0,
  };
  for (const s of settlements) {
    tally[s.outcome]++;
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[worker.vault] processed=${claimed.length} completed=${tally.completed} skipped=${tally.skipped} rate_limited=${tally.rate_limited} failed=${tally.failed} dead=${tally.dead} in ${durationMs}ms`
  );

  return Response.json({
    ok: true,
    processed: claimed.length,
    durationMs,
    ...tally,
    settlements: settlements.map((s, i) => ({
      rowId: claimed[i]!.id,
      kind: claimed[i]!.kind,
      sourceId: claimed[i]!.source_id,
      outcome: s.outcome,
      durationMs: s.durationMs,
      reason: s.reason,
    })),
  });
}

// Manual trigger via POST mirrors GET — same auth, same behaviour.
export const POST = GET;
