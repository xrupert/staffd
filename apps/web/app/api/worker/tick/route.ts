/**
 * GET /api/worker/tick — Consolidated hourly cron tick.
 *
 * Why this exists: Vercel Hobby plan caps you at 2 cron jobs and daily-only
 * cadence. The codebase has FOUR logical workers (vault queue, morning brief,
 * scheduled, brief-push-dispatcher) of varying frequencies. Instead of four
 * crons, Vercel runs THIS endpoint once an hour and we fan out internally.
 *
 * Trade-off vs. dedicated per-worker crons (Pro plan):
 *   • Vault ingestion lag — was 1 min, now up to 60 min
 *   • Brief push dispatch — was 15 min, now up to 60 min
 *   • Morning brief — unchanged (only runs at 6 AM UTC)
 *   • Scheduled jobs  — unchanged (only runs at 8 AM UTC)
 *
 * Upgrade path: when Vercel Pro is enabled, restore the per-worker crons in
 * vercel.json (the historical block is preserved in this file's git history)
 * and delete this tick endpoint OR keep it as a manual run target.
 *
 * Dispatch rules (UTC):
 *   • Every tick                     → vault queue drain, brief push dispatcher
 *   • Tick where UTC hour == 6       → morning-brief
 *   • Tick where UTC hour == 8       → scheduled
 *
 * Auth: `Bearer ${CRON_SECRET}` (Vercel cron) or `x-worker-secret`
 * (manual / scripted). Mirrors every other worker route.
 *
 * Internal fan-out: hits each worker route via VERCEL_URL with the
 * shared WORKER_SECRET header. Each sub-worker is independently fail-safe;
 * we collect per-worker outcomes and always return 200 so a single sub-worker
 * failure doesn't poison the cron itself.
 */

export const dynamic = "force-dynamic";

type SubOutcome = {
  worker: string;
  ok: boolean;
  status?: number;
  ms?: number;
  body?: unknown;
  error?: string;
  skipped?: boolean;
};

const WORKERS_ALWAYS = ["vault", "brief-push-dispatcher"] as const;
const TIMEOUT_MS = 50_000; // each sub-worker; Vercel max is 60s on Hobby fn

function authOk(req: Request): boolean {
  const cron = process.env.CRON_SECRET;
  const worker = process.env.WORKER_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  if (cron && authHeader === `Bearer ${cron}`) return true;
  if (worker && workerHeader === worker) return true;
  return false;
}

function baseUrl(): string {
  // VERCEL_URL is the deployment URL (no protocol). Falls back to staffd-web for
  // pathological cases (shouldn't happen on Vercel).
  const v = process.env.VERCEL_URL?.trim();
  if (v) return `https://${v}`;
  return "https://urstaffd.com";
}

async function callWorker(slug: string): Promise<SubOutcome> {
  const url = `${baseUrl()}/api/worker/${slug}`;
  const secret = process.env.WORKER_SECRET ?? "";
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-worker-secret": secret },
      signal: ac.signal,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* tolerate non-JSON */ }
    return {
      worker: slug,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      body,
    };
  } catch (e) {
    return {
      worker: slug,
      ok: false,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!authOk(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const utcHour = new Date().getUTCHours();
  const toRun: string[] = [...WORKERS_ALWAYS];
  if (utcHour === 6) toRun.push("morning-brief");
  if (utcHour === 8) toRun.push("scheduled");

  // Sequential — keeps total tick under the 60s function limit and avoids
  // hammering downstream services (PB, Qdrant, Anthropic) concurrently.
  const outcomes: SubOutcome[] = [];
  for (const slug of toRun) {
    outcomes.push(await callWorker(slug));
  }

  const allOk = outcomes.every((o) => o.ok);
  return Response.json(
    {
      ok: true, // always 200 — cron itself succeeded regardless of sub-worker state
      tickUtcHour: utcHour,
      ran: toRun,
      allSubWorkersOk: allOk,
      outcomes,
    },
    { status: 200 },
  );
}
