/**
 * POST /api/intent/commit — the single commit path for confirmed intents
 * (W95.1 → W95.5).
 *
 * Body: { intent_type, fields, source: "voice"|"text"|"ui"|"autopilot", edited? }.
 * Per-type work lives in COMMIT_HANDLERS; vendor mirrors ride the W71 bus
 * (Standard #20). W95.5 adds:
 *   - autopilot fire (source="autopilot"): audited intents write an
 *     autopilot_audit_log row + the response carries undo info.
 *   - streak accrual: a clean confirm (or fire) is +1; an edited confirm is a
 *     no-op (we parsed imperfectly). Cancel/decline/enable run via /api/autopilot.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { COMMIT_HANDLERS, AUDITED_TARGET } from "../../_lib/intent/commit-handlers";
import { INTENT_FIELDS } from "../../_lib/orchestrator/intent-policy";
import { incrementStreak } from "../../_lib/autopilot/policy";

type Body = { intent_type?: string; fields?: Record<string, string>; source?: string; edited?: boolean };

const UNDO_WINDOW_SECONDS = 600; // 10 minutes (toast caps at 10s client-side)

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const type = body.intent_type ?? "";
  const handler = COMMIT_HANDLERS[type];
  if (!handler) return Response.json({ error: "unsupported_intent" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }

  const source = body.source ?? "text";
  const result = await handler(body.fields ?? {}, { token, userId: me.id, source });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  const extra = (result.extra ?? {}) as Record<string, unknown>;
  const isExtractable = type in INTENT_FIELDS;
  const undoInfo: Record<string, unknown> = {};

  // W95.5 — autopilot fire on an AUDITED intent → write the reversal audit row.
  if (source === "autopilot" && AUDITED_TARGET[type]) {
    const committedAt = new Date();
    const expires = new Date(committedAt.getTime() + UNDO_WINDOW_SECONDS * 1000);
    const auditRes = await fetch(`${pbUrl()}/api/collections/autopilot_audit_log/records`, {
      method: "POST", headers: adminHeaders(token),
      body: JSON.stringify({
        user: me.id, intent_type: type, fields_committed: body.fields ?? {},
        previous_state: extra.previous_state ?? null, target_collection: AUDITED_TARGET[type],
        target_record_id: result.record_id, vendor_mirror_task_ids: [],
        committed_at: committedAt.toISOString(), undo_window_expires_at: expires.toISOString(), undone_at: "",
      }),
    });
    if (auditRes.ok) {
      undoInfo.audit_row_id = ((await auditRes.json()) as { id: string }).id;
      undoInfo.undo_window_seconds = UNDO_WINDOW_SECONDS;
    }
  }

  // W95.5 — streak accrual. Autopilot fire = +1; normal confirm = +1 unless the
  // user edited the parsed fields. undo / disable_autopilot / status-updates
  // aren't extractable intents → no streak.
  if (isExtractable) {
    const edited = source === "autopilot" ? false : body.edited === true;
    await incrementStreak(me.id, type, { edited }, token);
  }

  // Operator audit (best-effort).
  void fetch(`${pbUrl()}/api/collections/super_admin_usage_log/records`, {
    method: "POST", headers: adminHeaders(token),
    body: JSON.stringify({ user: me.id, operation_type: "intent_commit", operation_detail: `${type} (${source})`, parameters: JSON.stringify({ intent_type: type }) }),
  }).catch(() => {});

  return Response.json({ ok: true, intent_type: type, record_id: result.record_id, ...extra, ...undoInfo });
}
