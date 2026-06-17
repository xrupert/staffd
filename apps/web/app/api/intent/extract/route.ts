/**
 * POST /api/intent/extract — run conversational intent extraction on a message
 * (W95.1). Returns an IntentResult above the confidence floor, or null.
 *
 * Authed user. The CommandCenter calls this alongside the normal routing flow;
 * a non-null result surfaces the ConfirmActionModal. Never throws.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { extractIntent, INTENT_CONFIDENCE_THRESHOLD } from "../../_lib/orchestrator/intent";

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ intent: null });

  const result = await extractIntent(message);
  if (!result || result.confidence < INTENT_CONFIDENCE_THRESHOLD) {
    return Response.json({ intent: null });
  }
  return Response.json({ intent: result });
}
