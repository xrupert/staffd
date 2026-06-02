/**
 * POST /api/push/send — admin / operator manual push trigger.
 *
 * Body: { userId, payload: { title, body, url?, tag?, icon? } }
 * Auth: Bearer token via Authorization header. Accepted secrets:
 *   - PUSH_ADMIN_SECRET (preferred)
 *   - WORKER_SECRET (fallback so the same operator token works for both)
 *
 * Used for ad-hoc messaging ("STAFFD is down for maintenance at 8 PM").
 * Production triggers (Morning Brief ready, etc.) call `sendPushToUser`
 * from `_lib/push` directly — no self-HTTP.
 */

import { pushConfigured, sendPushToUser, type PushPayload } from "../../_lib/push";

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const adminSecret = process.env.PUSH_ADMIN_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";
  if (adminSecret && auth === `Bearer ${adminSecret}`) return true;
  if (workerSecret && auth === `Bearer ${workerSecret}`) return true;
  return false;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return Response.json({ error: "push_not_configured" }, { status: 503 });
  }

  let body: { userId?: string; payload?: PushPayload };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const { userId, payload } = body;
  if (!userId || !payload?.title || !payload?.body) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const result = await sendPushToUser(userId, payload);
  return Response.json({ ok: true, ...result });
}
