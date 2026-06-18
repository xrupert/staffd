/**
 * POST/DELETE /api/admin/plausible/<userId> (W95.6.y) — operator provisioning
 * of a customer's Plausible site id (the CE has no Sites API; the operator
 * creates the site manually, then stores its id here). Super-admin gated.
 * Writes businesses.plausible_site_id + an audit row.
 */

import { adminHeaders, getAdminToken, pbUrl, pbEscape } from "../../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse } from "../../../_lib/auth/super-admin";

type Ctx = { params: Promise<{ userId: string }> };

async function bizIdFor(pb: string, token: string, userId: string): Promise<string | null> {
  const res = await fetch(`${pb}/api/collections/businesses/records?filter=${encodeURIComponent(`user = "${pbEscape(userId)}"`)}&perPage=1&fields=id`, { headers: { Authorization: token } });
  if (!res.ok) return null;
  return (((await res.json()) as { items?: { id: string }[] }).items?.[0]?.id) ?? null;
}

async function audit(pb: string, token: string, opUser: string, detail: string) {
  void fetch(`${pb}/api/collections/super_admin_usage_log/records`, {
    method: "POST", headers: adminHeaders(token),
    body: JSON.stringify({ user: opUser, operation_type: "plausible_provision", operation_detail: detail, parameters: "{}" }),
  }).catch(() => {});
}

/** Persist the (already-validated) site id; assumes auth already passed. */
async function persistSite(opUserId: string, userId: string, value: string): Promise<Response> {
  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "PocketBase not configured" }, { status: 503 }); }
  const pb = pbUrl();
  const bizId = await bizIdFor(pb, token, userId);
  if (!bizId) return Response.json({ error: "no_business_row" }, { status: 404 });
  const res = await fetch(`${pb}/api/collections/businesses/records/${bizId}`, { method: "PATCH", headers: adminHeaders(token), body: JSON.stringify({ plausible_site_id: value }) });
  if (!res.ok) return Response.json({ error: "save_failed" }, { status: 502 });
  await audit(pb, token, opUserId, `${value ? "set" : "cleared"} plausible_site_id for ${userId}${value ? ` = ${value}` : ""}`);
  return Response.json({ ok: true, plausible_site_id: value });
}

export async function POST(req: Request, { params }: Ctx) {
  // Auth FIRST (W95.7) — consistent with DELETE; an anonymous caller always
  // gets 401, never a 400 that would leak that the endpoint exists / its shape.
  let me: { id: string; email: string };
  try { me = await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }
  let body: { site_id?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const site = (body.site_id ?? "").trim();
  if (!site) return Response.json({ error: "site_id_required" }, { status: 400 });
  const { userId } = await params;
  return persistSite(me.id, userId, site);
}

export async function DELETE(req: Request, { params }: Ctx) {
  let me: { id: string; email: string };
  try { me = await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }
  const { userId } = await params;
  return persistSite(me.id, userId, "");
}
