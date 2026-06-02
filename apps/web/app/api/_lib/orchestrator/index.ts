/**
 * Orchestrator entry point — `runOrchestrator(request)`.
 *
 * Both the public HTTP route (`/api/orchestrator`) and internal lib consumers
 * (e.g. `/api/orchestrate` after the B2 cutover) go through this function so
 * we get the same:
 *
 *   • intent dispatch to the right handler
 *   • last-resort throw → structured `upstream_error` envelope
 *   • fire-and-forget log row to `orchestrator_decisions`
 *
 * Direct lib import is preferred over self-HTTP — it avoids the Vercel-internal
 * fetch hop and keeps a single audited execution path.
 */

import { handleRoute } from "./handlers/route";
import { handleHandoff } from "./handlers/handoff";
import { handleBrief } from "./handlers/brief";
import { handleSynthesize } from "./handlers/synthesize";
import { logDecision } from "./logger";
import type {
  OrchestratorIntent,
  OrchestratorRequest,
  OrchestratorResponse,
} from "./types";

export const KNOWN_INTENTS: ReadonlySet<OrchestratorIntent> = new Set([
  "route",
  "handoff",
  "brief",
  "synthesize",
]);

function dispatch(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  switch (req.intent) {
    case "route":      return handleRoute(req);
    case "handoff":    return handleHandoff(req);
    case "brief":      return handleBrief(req);
    case "synthesize": return handleSynthesize(req);
  }
}

/**
 * Run an orchestrator request. Always returns a structured envelope —
 * never throws — and always emits one decision log row (fire-and-forget).
 */
export async function runOrchestrator(
  req: OrchestratorRequest
): Promise<OrchestratorResponse> {
  let response: OrchestratorResponse;
  try {
    response = await dispatch(req);
  } catch (err) {
    console.error("[orchestrator] unhandled handler error:", err);
    response = {
      ok: false,
      intent: req.intent,
      fallback: "upstream_error",
      degraded: { rationale: "Internal handler error — degraded." },
      latencyMs: 0,
      attempts: 0,
    };
  }

  void logDecision({
    user: req.userId,
    intent: req.intent,
    decision_json: response.ok ? response.decision : response.degraded,
    latency_ms: response.latencyMs,
    attempts: response.attempts,
    tokens_in: response.ok ? (response.tokensIn ?? 0) : 0,
    tokens_out: response.ok ? (response.tokensOut ?? 0) : 0,
    fallback: response.ok ? null : response.fallback,
    vault_cost_flag: response.vaultCostFlag ?? null,
    model: response.model ?? null,
    estimated_cost_usd: response.costUsd ?? null,
  });

  return response;
}

export type { OrchestratorIntent, OrchestratorRequest, OrchestratorResponse };
