/**
 * /api/admin/orphan-decisions
 *
 * GET — list all recorded orphan decisions (super-admin)
 * POST — record an operator decision (super-admin)
 *
 * Decision 71 — operator records intent per orphan collection via the
 * dashboard "Investigation Panel" action buttons. Decisions persist to
 * `orphan_decisions` PB collection (setup route: setup/orphan-decisions).
 *
 * NO destructive operations from this endpoint. Recording a "drop_safe"
 * decision creates a PB row; a separate Senior-Architect-authorized
 * follow-up PR actually performs the drop.
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI).
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";

const VALID_DECISIONS = new Set([
  "drop_safe",
  "drop_after_migration",
  "investigate_active_usage",
  "keep_with_setup_route",
]);

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

async function gateSuperAdmin(req: Request): Promise<{ ok: true; userId: string } | { ok: false; res: Response }> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return { ok: false, res: Response.json({ error: "missing_auth" }, { status: 401 }) };
  const me = await whoAmI(pbToken);
  if (!me) return { ok: false, res: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    return { ok: false, res: Response.json({ error: "admin_not_configured" }, { status: 503 }) };
  }
  if (me.email.trim().toLowerCase() !== adminEmail) {
    return { ok: false, res: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, userId: me.id };
}

export async function GET(req: Request): Promise<Response> {
  const gate = await gateSuperAdmin(req);
  if (!gate.ok) return gate.res;

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const url = pbUrl();
  try {
    const res = await fetch(
      `${url}/api/collections/orphan_decisions/records?sort=-created&perPage=200`,
      { headers: { Authorization: adminToken } },
    );
    if (!res.ok) {
      // Collection not yet created (setup route not run yet) — return empty list
      if (res.status === 404) return Response.json({ decisions: [] });
      const detail = await res.text();
      return Response.json({ error: "fetch_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
    const data = (await res.json()) as { items?: unknown[] };
    return Response.json({ decisions: data.items ?? [] });
  } catch (err) {
    return Response.json(
      { error: "fetch_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const gate = await gateSuperAdmin(req);
  if (!gate.ok) return gate.res;

  let body: { collection_name?: string; decision?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { collection_name, decision, reason } = body;
  if (!collection_name?.trim()) {
    return Response.json({ error: "collection_name_required" }, { status: 400 });
  }
  if (!decision || !VALID_DECISIONS.has(decision)) {
    return Response.json(
      { error: "invalid_decision", allowed: [...VALID_DECISIONS] },
      { status: 400 },
    );
  }

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const url = pbUrl();
  try {
    const res = await fetch(`${url}/api/collections/orphan_decisions/records`, {
      method: "POST",
      headers: adminHeaders(adminToken),
      body: JSON.stringify({
        collection_name: collection_name.trim(),
        decision,
        reason: reason?.trim() ?? "",
        decided_by: gate.userId,
        status: "pending",
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // If collection doesn't exist yet, hint to run setup
      if (res.status === 404) {
        return Response.json(
          {
            error: "collection_not_created",
            hint: "Run POST /api/setup/orphan-decisions to create the collection.",
          },
          { status: 503 },
        );
      }
      return Response.json({ error: "create_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
    const created = (await res.json()) as { id: string };
    return Response.json({ ok: true, id: created.id, decision, collection_name });
  } catch (err) {
    return Response.json(
      { error: "create_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
