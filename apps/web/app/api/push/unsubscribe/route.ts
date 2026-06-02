/**
 * POST /api/push/unsubscribe
 *
 * Body: { userId, pbToken, endpoint }
 * Deletes the matching `push_subscriptions` row. Used when the user turns
 * notifications off in Settings or when the browser revokes permission.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";

async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id === userId;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: { userId?: string; pbToken?: string; endpoint?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const { userId, pbToken, endpoint } = body;
  if (!userId || !pbToken || !endpoint) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const sub = await pbFirst<{ id: string; user: string }>(
      "push_subscriptions",
      `(endpoint='${pbEscape(endpoint)}')`,
      token,
      { fields: "id,user" }
    );
    if (!sub) return Response.json({ ok: true, action: "noop" });
    if (sub.user !== userId) return Response.json({ error: "forbidden" }, { status: 403 });

    await fetch(`${url}/api/collections/push_subscriptions/records/${sub.id}`, {
      method: "DELETE",
      headers: adminHeaders(token),
    });
    return Response.json({ ok: true, action: "deleted" });
  } catch (err) {
    console.error("push unsubscribe error:", err);
    return Response.json({ error: "unsubscribe_failed" }, { status: 500 });
  }
}
