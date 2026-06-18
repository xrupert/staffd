/**
 * POST /api/autopilot/<action> (W95.5) — graduation-flow + streak mutations.
 *   - enable  : turn autopilot ON for an intent (the "Yes, automate it" button +
 *               the Settings toggle).
 *   - decline : the "Not yet" button — reset streak + suppress the offer 30 days.
 *   - cancel  : modal cancel — gentle streak decrement (floor 0).
 * Authed; all mutations are USER-scoped in policy.ts.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { setEnabled, recordSuppression, decrementStreak } from "../../_lib/autopilot/policy";

const SUPPRESS_DAYS = 30;

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { action } = await params;

  let body: { intent_type?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const intent = (body.intent_type ?? "").trim();
  if (!intent) return Response.json({ error: "intent_type_required" }, { status: 400 });

  switch (action) {
    case "enable":  await setEnabled(me.id, intent, true); return Response.json({ ok: true, enabled: true });
    case "disable": await setEnabled(me.id, intent, false); return Response.json({ ok: true, enabled: false });
    case "decline": await recordSuppression(me.id, intent, SUPPRESS_DAYS); return Response.json({ ok: true });
    case "cancel":  await decrementStreak(me.id, intent); return Response.json({ ok: true });
    default: return Response.json({ error: "unknown_action" }, { status: 404 });
  }
}
