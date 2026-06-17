/**
 * POST   /api/user-integrations/[type]  — create/update the authed user's creds.
 * DELETE /api/user-integrations/[type]  — disconnect (delete the row).
 *
 * Authenticated user (any plan), NOT super-admin. USER_OWNED_RULES isolate
 * rows at the PB tier. api_key is AES-GCM encrypted before storage; the
 * plaintext is never returned. (W91)
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { encryptSecret } from "../../_lib/integrations/crypto";
import { INTEGRATION_TYPES, type IntegrationType } from "../../_lib/integrations/resolve";

type RouteContext = { params: Promise<{ type: string }> };

function isType(t: string): t is IntegrationType {
  return (INTEGRATION_TYPES as string[]).includes(t);
}

async function findRow(token: string, userId: string, type: string): Promise<{ id: string } | null> {
  const filter = `(user = "${pbEscape(userId)}" && integration_type = "${pbEscape(type)}")`;
  const res = await fetch(
    `${pbUrl()}/api/collections/user_integrations/records?filter=${encodeURIComponent(filter)}&perPage=1&fields=id`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return null;
  return ((await res.json()) as { items?: { id: string }[] }).items?.[0] ?? null;
}

export async function POST(req: Request, { params }: RouteContext) {
  const { type } = await params;
  if (!isType(type)) return Response.json({ error: "unknown_integration" }, { status: 400 });

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { connection_url?: string; api_key?: string; additional_config?: Record<string, unknown> };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const connection_url = (body.connection_url ?? "").trim();
  const rawKey = (body.api_key ?? "").trim();
  const config = { ...(body.additional_config ?? {}) };

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }

  const existing = await findRow(token, me.id, type);

  // Build the patch. Only re-encrypt when a new key is supplied — an empty
  // api_key on update means "keep the stored key".
  const fields: Record<string, unknown> = { user: me.id, integration_type: type, connection_url, status: "disconnected" };
  if (rawKey) {
    try { fields.api_key = encryptSecret(rawKey); }
    catch (err) { return Response.json({ error: "encryption_unavailable", detail: err instanceof Error ? err.message : "" }, { status: 503 }); }
    config.key_last4 = rawKey.slice(-4); // non-secret display hint
  }
  fields.additional_config = config;

  const url = existing
    ? `${pbUrl()}/api/collections/user_integrations/records/${existing.id}`
    : `${pbUrl()}/api/collections/user_integrations/records`;
  const res = await fetch(url, {
    method: existing ? "PATCH" : "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    return Response.json({ error: "save_failed", detail: (await res.text().catch(() => "")).slice(0, 200) }, { status: 502 });
  }
  return Response.json({ ok: true, type, status: "disconnected" });
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const { type } = await params;
  if (!isType(type)) return Response.json({ error: "unknown_integration" }, { status: 400 });

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }

  const existing = await findRow(token, me.id, type);
  if (!existing) return Response.json({ ok: true, type, status: "disconnected", deleted: false });

  const res = await fetch(`${pbUrl()}/api/collections/user_integrations/records/${existing.id}`, {
    method: "DELETE",
    headers: adminHeaders(token),
  });
  if (!res.ok) return Response.json({ error: "delete_failed" }, { status: 502 });
  return Response.json({ ok: true, type, status: "disconnected", deleted: true });
}
