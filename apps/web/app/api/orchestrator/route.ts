/**
 * POST /api/orchestrator
 *
 * The Brain. Single public entry point for every "smart" surface in the
 * platform. Spec §5 / §19 Foundation 1.
 *
 *   Body: {
 *     intent:    "route" | "handoff" | "brief" | "synthesize",
 *     userId:    string,
 *     pbToken:   string,
 *     clientId?: string,
 *     context:   Record<string, unknown>,
 *   }
 *
 * Returns the structured `OrchestratorResponse` envelope. Never 500s — every
 * failure path produces a degraded result instead. Internal lib consumers
 * should import `runOrchestrator` directly from `_lib/orchestrator` to skip
 * the self-HTTP hop while still getting the same dispatch + logging.
 */

import { KNOWN_INTENTS, runOrchestrator } from "../_lib/orchestrator";
import type { OrchestratorRequest } from "../_lib/orchestrator/types";

export async function POST(req: Request) {
  let body: Partial<OrchestratorRequest>;
  try {
    body = (await req.json()) as Partial<OrchestratorRequest>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const intent = body.intent;
  if (!intent || !KNOWN_INTENTS.has(intent)) {
    return Response.json({ error: "unknown_intent" }, { status: 400 });
  }

  const orchestratorReq: OrchestratorRequest = {
    intent,
    userId: body.userId ?? "",
    pbToken: body.pbToken ?? "",
    clientId: body.clientId,
    context: (body.context ?? {}) as Record<string, unknown>,
  };

  const response = await runOrchestrator(orchestratorReq);
  return Response.json(response);
}
