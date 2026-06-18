/**
 * POST /api/intent/commit — the single commit path for confirmed intents
 * (W95.1 + W95.4a).
 *
 * Body: { intent_type, fields, source: "voice" | "text" }. Every Model B3
 * intent funnels through here; the per-type work lives in COMMIT_HANDLERS
 * (_lib/intent/commit-handlers.ts). Each handler writes the STAFFD-native row(s)
 * (source of truth) and enqueues any vendor mirror onto the W71 task bus —
 * there are NO inline vendor calls here anymore (Standard #20). This route only
 * authenticates, dispatches, audits, and Responds.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { COMMIT_HANDLERS } from "../../_lib/intent/commit-handlers";
import type { IntentType } from "../../_lib/orchestrator/intent";

type Body = { intent_type?: string; fields?: Record<string, string>; source?: "voice" | "text" };

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const type = (body.intent_type ?? "") as IntentType;
  const handler = COMMIT_HANDLERS[type];
  if (!handler) return Response.json({ error: "unsupported_intent" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }

  const source = body.source ?? "text";
  const result = await handler(body.fields ?? {}, { token, userId: me.id, source });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  // Audit (best-effort).
  void fetch(`${pbUrl()}/api/collections/super_admin_usage_log/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: me.id,
      operation_type: "intent_commit",
      operation_detail: `${type} (${source})`,
      parameters: JSON.stringify({ intent_type: type }),
    }),
  }).catch(() => {});

  return Response.json({ ok: true, intent_type: type, record_id: result.record_id, ...(result.extra ?? {}) });
}
