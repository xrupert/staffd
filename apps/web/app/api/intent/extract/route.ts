/**
 * POST /api/intent/extract — conversational intent extraction (W95.1 → W95.5).
 * Returns { intents, autofire?, graduationOffer? }:
 *   - intents: IntentResult[] (empty / one / two for disambiguation)
 *   - autofire: true when a SINGLE unambiguous intent should fire automatically
 *     (autopilot enabled for it) — the client commits with source="autopilot"
 *     and shows the undo toast, no modal.
 *   - graduationOffer: true when the modal should render the "automate it?" block.
 * Ambiguity (2 intents) always forces the modal — never autofires.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { extractIntent } from "../../_lib/orchestrator/intent";
import { shouldAutopilot, shouldOfferGraduation } from "../../_lib/autopilot/policy";

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { message?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ intents: [] });

  const intents = await extractIntent(message);
  if (intents.length !== 1) return Response.json({ intents }); // 0 → none; 2 → always modal

  const only = intents[0]!;
  if (await shouldAutopilot(me.id, only.type, false)) {
    return Response.json({ intents, autofire: true });
  }
  if (await shouldOfferGraduation(me.id, only.type)) {
    return Response.json({ intents, graduationOffer: true });
  }
  return Response.json({ intents });
}
