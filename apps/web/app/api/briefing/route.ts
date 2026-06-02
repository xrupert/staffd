/**
 * CEO Weekly Briefing — thin wrapper over orchestrator `intent:"brief"`.
 *
 * B3 cutover: this route no longer carries its own Claude call, its own
 * activity-rollup logic, or the hand-rolled "Chief of Staff" system prompt.
 * Everything lives in `_lib/orchestrator/handlers/brief.ts`, which uses the
 * real `ceo-chief-of-staff` agent from `packages/agents`.
 *
 * Streaming UX: the orchestrator is non-streaming today, so the brief text
 * is delivered in one chunk. The dashboard's existing reader loop handles
 * single-chunk delivery without change.
 *
 * On `ok:false` (deadline / budget / upstream), we stream the deterministic
 * degraded brief from the orchestrator's fallback layer — never an empty
 * body.
 */

import { runOrchestrator } from "../_lib/orchestrator";

export async function POST(req: Request) {
  let body: { userId?: string; pbToken?: string; clientId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { userId, pbToken, clientId } = body;
  if (!userId || !pbToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const response = await runOrchestrator({
    intent: "brief",
    userId,
    pbToken,
    clientId,
    context: {},
  });

  const briefText = response.ok
    ? (response.decision.task ?? "").trim()
    : (response.degraded.task ?? "").trim();

  // Last-resort guard — if even the degraded path produced nothing, give the
  // user a coherent message instead of an empty stream.
  const finalText = briefText.length > 0
    ? briefText
    : "## Weekly Briefing\n\nThe coordinator is temporarily unavailable. Please try again in a moment.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(finalText));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
