/**
 * Orchestrator contract — locked types.
 *
 * Spec §5 / §19 Foundation 1. Every "smart" surface in the platform routes
 * through `POST /api/orchestrator`. The shapes here are the protocol — any
 * change requires a roadmap revision, not a code change.
 */

export type OrchestratorIntent = "route" | "handoff" | "brief" | "synthesize";

/** Generic request shape — handlers cast `context` to their per-intent type. */
export type OrchestratorRequest = {
  intent: OrchestratorIntent;
  userId: string;
  pbToken: string;
  clientId?: string;        // Agency mode
  context: Record<string, unknown>;
};

/** Structured decision returned by every successful intent run. */
export type OrchestratorDecision = {
  department?: string;
  agentId?: string;
  task?: string;
  rationale?: string;
};

/** Suggested cross-functional next step from intent=handoff. */
export type FollowUp = {
  department: string;
  task: string;
  rationale: string;
  locked?: boolean;         // surface as upsell trigger if true
};

/**
 * Envelope returned by every handler. Spec §B1: "Same envelope for every
 * intent — consumers branch on `ok`."
 *
 * On `ok:true`:    `decision` is populated; consumer renders it.
 * On `ok:false`:   `fallback` names the failure; `degraded` is the
 *                  deterministic best-effort output (never null) so consumers
 *                  always have something to show.
 */
export type OrchestratorResponse =
  | {
      ok: true;
      intent: OrchestratorIntent;
      decision: OrchestratorDecision;
      followUps?: FollowUp[];
      notes?: string;
      vaultCostFlag?: "ok" | "trimmed" | "degraded";
      latencyMs: number;
      attempts: number;
      tokensIn?: number;
      tokensOut?: number;
      /** Model the LLM wrapper actually called (Phase 3 routing visibility). */
      model?: string;
      /** Estimated cost of this call in USD (Phase 3 cost logging). */
      costUsd?: number;
    }
  | {
      ok: false;
      intent: OrchestratorIntent;
      fallback: FallbackReason;
      degraded: OrchestratorDecision & { followUps?: FollowUp[]; notes?: string };
      vaultCostFlag?: "ok" | "trimmed" | "degraded";
      latencyMs: number;
      attempts: number;
      model?: string;
      costUsd?: number;
    };

export type FallbackReason =
  | "deadline_exceeded"
  | "llm_budget_exceeded"
  | "upstream_error"
  | "not_implemented";

/** Per-intent log payload — one row per orchestrator request. */
export type DecisionLog = {
  user: string;
  intent: OrchestratorIntent;
  decision_json: unknown;
  latency_ms: number;
  attempts: number;
  tokens_in: number;
  tokens_out: number;
  fallback?: FallbackReason | null;
  vault_cost_flag?: "ok" | "trimmed" | "degraded" | null;
  model?: string | null;
  /** Estimated USD cost of this call. Phase 3. */
  estimated_cost_usd?: number | null;
};
