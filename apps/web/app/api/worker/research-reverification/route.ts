import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import {
  buildReverificationQuery,
  evaluateReverification,
  type ResearchKnowledgeRecord,
} from "../../_lib/orchestrator/research-reverification";

const RECORDS_PER_TICK = 25;

function authorized(request: Request): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const workerHeader = request.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";
  return Boolean(
    (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (workerSecret && workerHeader === workerSecret),
  );
}

type StoredResearchRecord = ResearchKnowledgeRecord & {
  reverify_status?: "scheduled" | "due" | "researching" | "failed";
  reverify_query?: string;
  reverify_requested_at?: string;
};

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const now = new Date();
  const filter = encodeURIComponent(
    `reverify_after != "" && reverify_after <= "${now.toISOString()}" && (review_status = "approved" || review_status = "not_required") && (reverify_status = "" || reverify_status = "scheduled")`,
  );
  const response = await fetch(
    `${pbUrl()}/api/collections/research_records/records?filter=${filter}&sort=reverify_after&perPage=${RECORDS_PER_TICK}`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (response.status === 404) return Response.json({ ok: true, scanned: 0, queued: 0, failed: 0 });
  if (!response.ok) return Response.json({ error: "research_reverification_query_failed" }, { status: 502 });

  const records = ((await response.json()) as { items?: StoredResearchRecord[] }).items ?? [];
  let queued = 0;
  let failed = 0;

  for (const record of records) {
    if (!evaluateReverification(record, now).due) continue;
    try {
      const patch = await fetch(
        `${pbUrl()}/api/collections/research_records/records/${encodeURIComponent(record.id)}`,
        {
          method: "PATCH",
          headers: adminHeaders(token),
          body: JSON.stringify({
            reverify_status: "due",
            reverify_query: buildReverificationQuery(record),
            reverify_requested_at: now.toISOString(),
          }),
        },
      );
      if (!patch.ok) throw new Error(`Research re-verification queue failed (${patch.status})`);
      queued++;
    } catch (error) {
      failed++;
      console.error(`Research re-verification failed record=${pbEscape(record.id)}:`, error);
    }
  }

  return Response.json({ ok: true, scanned: records.length, queued, failed });
}
