/**
 * /api/admin/migrations (W95.3.4) — super-admin only.
 *
 * GET  → the migration registry with live exists/missing status (detected
 *        server-side via the admin token, Standard #21) + each migration's
 *        last run from admin_migration_log.
 * POST → append an admin_migration_log audit row after the client runs a
 *        migration against /api/setup/<route> (dual-auth proxy). Best-effort:
 *        if the log collection isn't bootstrapped yet, returns ok:false.
 *
 * Status detection + logging both use the admin token. The actual migration is
 * run by the client against /api/setup/<route> with the super-admin session
 * (exercising the dual-auth proxy) — this route never re-implements setup.
 */

import { adminHeaders, getAdminToken, pbUrl, pbEscape } from "../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";
import { MIGRATION_REGISTRY, getMigration } from "../../_lib/admin/migrations";

const LOG_COLLECTION = "admin_migration_log";

async function collectionExists(pb: string, token: string, collection: string, detectField?: string): Promise<boolean | null> {
  try {
    // Schema-extension migration: "exists" means the field is present, not just
    // the collection. Read the collection schema and look for the field.
    if (detectField) {
      const res = await fetch(`${pb}/api/collections/${encodeURIComponent(collection)}`, { headers: { Authorization: token } });
      if (res.status === 404) return false;
      if (!res.ok) return null;
      const col = (await res.json()) as { fields?: { name: string }[] };
      return (col.fields ?? []).some((f) => f.name === detectField);
    }
    const res = await fetch(`${pb}/api/collections/${encodeURIComponent(collection)}/records?perPage=1&fields=id`, {
      headers: { Authorization: token },
    });
    if (res.ok) return true;
    if (res.status === 404) return false;
    return null; // indeterminate (e.g. transient)
  } catch {
    return null;
  }
}

async function lastRun(pb: string, token: string, route: string): Promise<{ ran_at: string; result: string } | null> {
  try {
    const filter = encodeURIComponent(`migration_name = "${pbEscape(route)}"`);
    const res = await fetch(
      `${pb}/api/collections/${LOG_COLLECTION}/records?filter=${filter}&perPage=1&sort=-created&fields=ran_at,result`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: { ran_at?: string; result?: string }[] };
    const row = data.items?.[0];
    return row ? { ran_at: row.ran_at ?? "", result: row.result ?? "" } : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  let me: { id: string; email: string };
  try { me = await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }
  void me;

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "PocketBase not configured" }, { status: 503 }); }
  const pb = pbUrl();

  const migrations = await Promise.all(
    MIGRATION_REGISTRY.map(async (m) => {
      const exists = await collectionExists(pb, token, m.collection, m.detectField);
      return {
        route: m.route,
        label: m.label,
        collection: m.collection,
        bootstrap: !!m.bootstrap,
        note: m.note ?? null,
        status: exists === null ? "unknown" : exists ? "exists" : "missing",
        lastRun: await lastRun(pb, token, m.route),
      };
    }),
  );

  return Response.json({ migrations, generatedAt: new Date().toISOString() });
}

export async function POST(req: Request) {
  let me: { id: string; email: string };
  try { me = await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }

  let body: { migration_name?: string; result?: string; response_body?: string; duration_ms?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const route = (body.migration_name ?? "").trim();
  if (!route || !getMigration(route)) return Response.json({ error: "unknown_migration" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "PocketBase not configured" }, { status: 503 }); }
  const pb = pbUrl();

  const res = await fetch(`${pb}/api/collections/${LOG_COLLECTION}/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: me.id,
      migration_name: route,
      ran_at: new Date().toISOString(),
      result: (body.result ?? "").slice(0, 64),
      response_body: (body.response_body ?? "").slice(0, 4000),
      duration_ms: typeof body.duration_ms === "number" ? body.duration_ms : 0,
    }),
  });
  if (!res.ok) {
    // log collection not bootstrapped yet — non-fatal (the migration itself ran)
    return Response.json({ ok: false, reason: "log_unavailable", status: res.status });
  }
  return Response.json({ ok: true });
}
