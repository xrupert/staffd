/**
 * GET /api/workflow/[id]  — workflow detail (W72).
 *
 * Returns the workflow record, its tasks (oldest first), and the aggregation
 * document if one has been produced. Access is super-admin OR the row owner
 * (canAccessWorkflow) — enforced here at the API tier on top of PB's
 * USER_OWNED row rules.
 *
 * Auth: PB session via `?pbToken=` or Authorization header.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { trySuperAdminFromToken } from "../../_lib/auth/super-admin";
import { canAccessWorkflow } from "../../_lib/workflow";

type RouteContext = { params: Promise<{ id: string }> };

/** Resolve the requesting user's id from a PB JWT (auth-refresh). */
async function whoAmI(pbToken: string): Promise<string | null> {
  if (!pbToken) return null;
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing_id" }, { status: 400 });

  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  // Identity: super-admin (bypass) or the requesting user's id.
  const admin = await trySuperAdminFromToken(pbToken);
  const requesterId = admin ? admin.id : await whoAmI(pbToken);
  if (!requesterId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  const pb = pbUrl();

  const wfRes = await fetch(`${pb}/api/collections/workflows/records/${encodeURIComponent(id)}`, {
    headers: { Authorization: token },
  });
  if (!wfRes.ok) return Response.json({ error: "not_found" }, { status: 404 });
  const workflow = (await wfRes.json()) as { id: string; user: string; aggregation_doc_id?: string };

  if (!canAccessWorkflow(requesterId, !!admin, workflow.user)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Tasks for this workflow (oldest first).
  const filter = encodeURIComponent(`(workflow_id = "${pbEscape(id)}")`);
  const tasksRes = await fetch(
    `${pb}/api/collections/workflow_tasks/records?filter=${filter}&perPage=200&sort=created`,
    { headers: { Authorization: token } },
  );
  const tasks = tasksRes.ok ? ((await tasksRes.json()) as { items?: unknown[] }).items ?? [] : [];

  // Aggregation document, if produced.
  let aggregationDoc: unknown = null;
  const docId = workflow.aggregation_doc_id;
  if (docId) {
    const docRes = await fetch(`${pb}/api/collections/documents/records/${encodeURIComponent(docId)}`, {
      headers: adminHeaders(token),
    });
    if (docRes.ok) aggregationDoc = await docRes.json();
  }

  return Response.json({ ok: true, workflow, tasks, aggregationDoc });
}
