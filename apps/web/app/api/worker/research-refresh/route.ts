import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { buildResearchRefreshRecord } from "../../_lib/orchestrator/research-refresh";
import { searchResearchSources } from "../../_lib/orchestrator/research-retrieval";
import {
  nextReverificationDeadline,
  type ResearchKnowledgeRecord,
} from "../../_lib/orchestrator/research-reverification";

const RECORDS_PER_TICK = 10;

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

type RefreshParent = ResearchKnowledgeRecord & {
  reverify_status?: string;
  reverify_query?: string;
  reverify_requested_at?: string;
};

async function refreshExists(token: string, parentId: string): Promise<boolean> {
  const filter = encodeURIComponent(`parent_record = "${pbEscape(parentId)}" && review_status = "pending"`);
  const response = await fetch(
    `${pbUrl()}/api/collections/research_records/records?filter=${filter}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Research refresh lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: unknown[] };
  return Boolean(payload.items?.length);
}

async function patchParent(token: string, id: string, body: Record<string, unknown>) {
  const response = await fetch(
    `${pbUrl()}/api/collections/research_records/records/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: adminHeaders(token), body: JSON.stringify(body) },
  );
  if (!response.ok) throw new Error(`Research parent update failed (${response.status})`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const filter = encodeURIComponent(`reverify_status = "due" && reverify_query != "" && superseded_by = ""`);
  const response = await fetch(
    `${pbUrl()}/api/collections/research_records/records?filter=${filter}&sort=reverify_requested_at&perPage=${RECORDS_PER_TICK}`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (response.status === 404) return Response.json({ ok: true, scanned: 0, created: 0, skipped: 0, failed: 0 });
  if (!response.ok) return Response.json({ error: "research_refresh_query_failed" }, { status: 502 });

  const records = ((await response.json()) as { items?: RefreshParent[] }).items ?? [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const parent of records) {
    try {
      if (await refreshExists(token, parent.id)) {
        await patchParent(token, parent.id, { reverify_status: "awaiting_review" });
        skipped++;
        continue;
      }

      await patchParent(token, parent.id, { reverify_status: "researching" });
      const search = await searchResearchSources(parent.reverify_query ?? "");
      const refresh = buildResearchRefreshRecord(
        parent,
        search,
        nextReverificationDeadline(parent.risk, new Date(search.retrievedAt)),
      );
      const createResponse = await fetch(`${pbUrl()}/api/collections/research_records/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify(refresh),
      });
      if (!createResponse.ok) throw new Error(`Research refresh create failed (${createResponse.status})`);
      await patchParent(token, parent.id, { reverify_status: "awaiting_review" });
      created++;
    } catch (error) {
      failed++;
      console.error(`Research refresh failed record=${pbEscape(parent.id)}:`, error);
      await patchParent(token, parent.id, { reverify_status: "failed" }).catch(() => undefined);
    }
  }

  return Response.json({ ok: true, scanned: records.length, created, skipped, failed });
}
