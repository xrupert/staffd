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
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";
import { logSuperAdminAccess } from "../../_lib/auth/super-admin-logging";

const VALID_DECISIONS = new Set([
  "drop_safe",
  "drop_after_migration",
  "investigate_active_usage",
  "keep_with_setup_route",
]);

/**
 * Thin wrapper around requireSuperAdmin that adapts to the result-object
 * pattern this file's GET/POST handlers were originally built against.
 * Decision 74 — refactored to delegate to the shared helper for the actual
 * gate logic; signature preserved for minimum churn.
 */
async function gateSuperAdmin(req: Request): Promise<{ ok: true; userId: string; email: string } | { ok: false; res: Response }> {
  try {
    const me = await requireSuperAdmin(req);
    void logSuperAdminAccess(me, "api_call", "/api/admin/orphan-decisions", { request: req });
    return { ok: true, userId: me.id, email: me.email };
  } catch (err) {
    return { ok: false, res: toAuthErrorResponse(err) };
  }
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
