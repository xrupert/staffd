/**
 * GET /api/admin/vault-metrics
 * Query: ?pbToken=...
 *
 * Phase 31 — Vault Metrics Dashboard.
 *
 * Returns a snapshot of system health for the operator:
 *   • Ingestion queue depths (pending / running / dead)
 *   • Document totals + 24h throughput
 *   • Brief delivery (total, pushed, delivery rate)
 *   • Conversation thread counts (24h, 7d, all-time)
 *   • Push subscription totals
 *
 * Auth: caller must be authenticated via pbToken AND the user's email must
 * match ADMIN_EMAIL (env). This is a deliberately tight gate — the metrics
 * surface lets you see aggregate counts across all users, so we don't want
 * regular signups reaching it.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";

async function whoAmI(pbToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

async function countRecords(collection: string, filter?: string): Promise<number> {
  const token = await getAdminToken();
  const url = pbUrl();
  const qs = new URLSearchParams({ page: "1", perPage: "1" });
  if (filter) qs.set("filter", filter);
  qs.set("fields", "id");
  try {
    const res = await fetch(`${url}/api/collections/${collection}/records?${qs.toString()}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalItems?: number };
    return data.totalItems ?? 0;
  } catch {
    return 0;
  }
}

function isoMinusHours(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  }
  if (me.email.trim().toLowerCase() !== adminEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const last24h = isoMinusHours(24);
  const last7d = isoMinusHours(24 * 7);

  // Batch all counts in parallel — PB will happily handle this volume.
  const [
    queuePending, queueRunning, queueDead, queueCompleted24h,
    docsTotal, docs24h,
    briefsTotal, briefsPushed, briefs7d,
    threadsTotal, threads24h, threads7d,
    pushSubsTotal,
    usersTotal, usersWithDocs,
  ] = await Promise.all([
    countRecords("vault_ingest_queue", "status='pending'"),
    countRecords("vault_ingest_queue", "status='running'"),
    countRecords("vault_ingest_queue", "status='dead'"),
    countRecords("vault_ingest_queue", `status='completed' && updated>='${last24h}'`),

    countRecords("documents"),
    countRecords("documents", `created>='${last24h}'`),

    countRecords("vault_briefs"),
    countRecords("vault_briefs", `pushed_at!='' && pushed_at!=null`),
    countRecords("vault_briefs", `created>='${last7d}'`),

    countRecords("conversation_threads").catch(() => 0),
    countRecords("conversation_threads", `created>='${last24h}'`).catch(() => 0),
    countRecords("conversation_threads", `created>='${last7d}'`).catch(() => 0),

    countRecords("push_subscriptions").catch(() => 0),

    countRecords("users"),
    countRecords("documents", `created>='${last7d}'`),
  ]);

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    queue: {
      pending: queuePending,
      running: queueRunning,
      dead: queueDead,
      completedLast24h: queueCompleted24h,
    },
    documents: {
      total: docsTotal,
      created24h: docs24h,
      activeWriters7d: usersWithDocs,
    },
    briefs: {
      total: briefsTotal,
      pushed: briefsPushed,
      deliveryRate: briefsTotal > 0 ? Math.round((briefsPushed / briefsTotal) * 100) : 0,
      created7d: briefs7d,
    },
    conversations: {
      total: threadsTotal,
      created24h: threads24h,
      created7d: threads7d,
    },
    pushSubscriptions: { total: pushSubsTotal },
    users: { total: usersTotal },
  });
}
