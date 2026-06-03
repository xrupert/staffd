/**
 * POST /api/admin/log-page-view
 *
 * Tiny fire-and-forget endpoint that lets client-side admin pages log
 * a dashboard_view to super_admin_audit_log without exposing the PB
 * admin token to the browser. Decision 74.
 *
 * Body: { resource: string }   — usually the pathname (e.g., "/dashboard/admin")
 */

import { requireSuperAdmin, toAuthErrorResponse, type SuperAdminUser } from "../../_lib/auth/super-admin";
import { logSuperAdminAccess } from "../../_lib/auth/super-admin-logging";

export async function POST(req: Request): Promise<Response> {
  let me: SuperAdminUser;
  try {
    me = await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  let body: { resource?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const resource = body.resource?.trim() || "/dashboard/admin/(unknown)";

  await logSuperAdminAccess(me, "dashboard_view", resource, { request: req });
  return Response.json({ ok: true });
}
