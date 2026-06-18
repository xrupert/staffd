/**
 * POST /api/intent/extract — run conversational intent extraction on a message
 * (W95.1 / W95.4b). Returns { intents: IntentResult[] } — empty, one, or two
 * (top-2 disambiguation). The CommandCenter surfaces ConfirmActionModal in
 * single or two-option mode based on length. Never throws.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { extractIntent } from "../../_lib/orchestrator/intent";

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ intents: [] });

  const intents = await extractIntent(message);
  return Response.json({ intents });
}
