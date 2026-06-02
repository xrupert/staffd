/**
 * GET /api/worker/brief-push-dispatcher  — Phase 26.
 *
 * Runs every 15 minutes. For each unpushed `vault_briefs` row (created in
 * the last 36h, status != reviewed), looks up the user's brief preferences
 * and consults `shouldDispatchPush()`. When all gates pass — timezone +
 * delivery hour reached, quiet hours clear, not snoozed, not too old — fires
 * the push and stamps `pushed_at` so the brief is never double-delivered.
 *
 * Briefs from users with NO timezone configured are left alone — the
 * morning-brief worker's legacy "push immediately after generation" path
 * already handled them. No double-push risk.
 *
 * Auth: same `CRON_SECRET` Bearer / `WORKER_SECRET` header pattern as the
 * other workers.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { sendPushToUser, pushConfigured } from "../../_lib/push";
import { shouldDispatchPush, type BriefSchedulePrefs } from "../../_lib/push-schedule";

const LOOKBACK_HOURS = 36;
const BATCH_SIZE = 100;
const CONCURRENCY = 4;

type BriefRow = {
  id: string;
  user: string;
  date: string;
  status: string;
  sections?: Array<{ id: string }>;
  generated_at?: string;
  created: string;
};

type SubRow = {
  user: string;
  timezone?: string | null;
  preferred_delivery_hour?: number | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  brief_snoozed_until?: string | null;
  skip_next_brief?: boolean | null;
};

function pbDateNHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

async function fetchPushablePrefs(userIds: string[], token: string): Promise<Map<string, SubRow>> {
  const map = new Map<string, SubRow>();
  if (userIds.length === 0) return map;
  try {
    const url = pbUrl();
    // PB doesn't have a clean IN clause; OR-join the user filter.
    const orClause = userIds.map((u) => `user='${pbEscape(u)}'`).join(" || ");
    const res = await fetch(
      `${url}/api/collections/subscriptions/records?filter=${encodeURIComponent(`(${orClause})`)}&perPage=${userIds.length}&fields=user,timezone,preferred_delivery_hour,quiet_hours_start,quiet_hours_end,brief_snoozed_until,skip_next_brief`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return map;
    const data = (await res.json()) as { items?: SubRow[] };
    for (const row of data.items ?? []) {
      if (row.user) map.set(row.user, row);
    }
  } catch { /* fall through with empty map */ }
  return map;
}

async function runWithLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        try { results[i] = await fn(items[i]!); } catch { /* swallow */ }
      }
    })
  );
  return results as R[];
}

async function markPushed(briefId: string, token: string): Promise<void> {
  try {
    const url = pbUrl();
    await fetch(`${url}/api/collections/vault_briefs/records/${briefId}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ pushed_at: new Date().toISOString() }),
    });
  } catch { /* best-effort */ }
}

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
  if (!pushConfigured()) {
    return Response.json({ ok: true, skipped: "push_not_configured" });
  }

  const start = Date.now();
  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch (err) {
    return Response.json({ error: "admin_auth_failed", detail: String(err) }, { status: 500 });
  }

  // Pull recent unpushed briefs. PB doesn't store NULL-aware comparisons
  // for missing fields cleanly, so we filter on created window + status, then
  // dedupe in JS against rows that already have pushed_at set.
  const since = pbDateNHoursAgo(LOOKBACK_HOURS);
  let briefs: BriefRow[] = [];
  try {
    const filter = `(created>='${since}' && status!='reviewed' && (pushed_at='' || pushed_at=null))`;
    const res = await fetch(
      `${url}/api/collections/vault_briefs/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=${BATCH_SIZE}&fields=id,user,date,status,sections,generated_at,created,pushed_at`,
      { headers: { Authorization: token } }
    );
    if (res.ok) {
      const data = (await res.json()) as { items?: Array<BriefRow & { pushed_at?: string | null }> };
      briefs = (data.items ?? []).filter((b) => !b.pushed_at) as BriefRow[];
    }
  } catch {
    return Response.json({ error: "brief_fetch_failed" }, { status: 500 });
  }

  if (briefs.length === 0) {
    return Response.json({ ok: true, scanned: 0, sent: 0, skipped: 0, durationMs: Date.now() - start });
  }

  // Pull each brief's user's prefs in one batched query.
  const userIds = Array.from(new Set(briefs.map((b) => b.user).filter(Boolean)));
  const prefsByUser = await fetchPushablePrefs(userIds, token);

  type Outcome =
    | { decision: "sent" }
    | { decision: "skipped"; reason: string };

  const settlements = await runWithLimit(briefs, CONCURRENCY, async (brief): Promise<Outcome> => {
    const prefs: BriefSchedulePrefs = prefsByUser.get(brief.user) ?? {};
    const decision = shouldDispatchPush(prefs, brief.created);
    if (!decision.ok) {
      return { decision: "skipped", reason: decision.reason };
    }
    const count = Array.isArray(brief.sections) ? brief.sections.length : 0;
    const r = await sendPushToUser(brief.user, {
      title: "Your Morning Brief is ready",
      body: `${count} update${count === 1 ? "" : "s"} from your staff. Tap to review.`,
      url: "/dashboard",
      tag: `brief-${brief.date}`,
    });
    if (r.skipped) return { decision: "skipped", reason: "push_skipped_no_subs_or_unconfigured" };
    await markPushed(brief.id, token);
    return { decision: "sent" };
  });

  let sent = 0;
  let skipped = 0;
  const reasons: Record<string, number> = {};
  for (const s of settlements) {
    if (s.decision === "sent") sent++;
    else {
      skipped++;
      reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    }
  }

  console.log(
    `[worker.brief-push-dispatcher] scanned=${briefs.length} sent=${sent} skipped=${skipped} reasons=${JSON.stringify(reasons)} in ${Date.now() - start}ms`
  );

  return Response.json({
    ok: true,
    scanned: briefs.length,
    sent,
    skipped,
    skipReasons: reasons,
    durationMs: Date.now() - start,
  });
}

export const POST = GET;
