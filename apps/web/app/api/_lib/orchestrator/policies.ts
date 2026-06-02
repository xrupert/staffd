/**
 * Per-intent policy table — single source of truth for the orchestrator's
 * latency, retry, and vault-cost knobs. Locked per Roadmap v2.
 *
 *  | Intent      | max_tokens | Deadline | Retries | Vault top-K | Vault token cap |
 *  | ----------- | ---------- | -------- | ------- | ----------- | --------------- |
 *  | route       | 512        |  4 s     | 0       | 3           | 1 000           |
 *  | handoff     | 1024       |  6 s     | 0       | 5           | 2 500           |
 *  | brief       | 4096       | 25 s     | 1       | 10          | 6 000           |
 *  | synthesize  | 4096       | 30 s     | 1       | 10          | 6 000           |
 *
 *  Soft input-token budget: 12 000 across all intents. Conversation message
 *  caps: 6 turns for `route`, 20 turns for `brief` and `synthesize`.
 */

import { MODELS } from "../llm-router";
import type { OrchestratorIntent } from "./types";

export type IntentPolicy = {
  intent: OrchestratorIntent;
  /** Output token cap for the LLM call. */
  maxTokens: number;
  /** Per-attempt hard deadline in ms. */
  deadlineMs: number;
  /** Number of retries after the first attempt. */
  retries: number;
  /** Top-K artifacts to retrieve from the Vault. */
  vaultTopK: number;
  /** Hard cap on total tokens of retrieved text injected into the prompt. */
  vaultMaxTokens: number;
  /** Conversation history cap (messages). */
  messageCap: number;
  /** Which packages/agents prompt drives this intent. */
  systemAgentId: string;
  /** Which Anthropic model handles this intent. Phase 3 — locked per spec. */
  model: string;
};

export const SOFT_INPUT_TOKEN_BUDGET = 12_000;

/**
 * Multiplier applied to `deadlineMs` to determine the wall-clock budget that
 * triggers `fallback:"llm_budget_exceeded"`. Spec §B1: "total wall-clock
 * across attempts > 1.5× deadline".
 */
export const BUDGET_DEADLINE_MULTIPLIER = 1.5;

export const POLICIES: Record<OrchestratorIntent, IntentPolicy> = {
  route: {
    intent: "route",
    maxTokens: 512,
    deadlineMs: 4_000,
    retries: 0,
    vaultTopK: 3,
    vaultMaxTokens: 1_000,
    messageCap: 6,
    systemAgentId: "ceo-agents-orchestrator",
    model: MODELS.haiku, // Phase 3 — cheap + fast routing
  },
  handoff: {
    intent: "handoff",
    maxTokens: 1_024,
    deadlineMs: 6_000,
    retries: 0,
    vaultTopK: 5,
    vaultMaxTokens: 2_500,
    messageCap: 20,
    systemAgentId: "ceo-agents-orchestrator",
    model: MODELS.haiku, // Phase 3 — short structured suggestions
  },
  brief: {
    intent: "brief",
    maxTokens: 4_096,
    deadlineMs: 25_000,
    retries: 1,
    vaultTopK: 10,
    vaultMaxTokens: 6_000,
    messageCap: 20,
    systemAgentId: "ceo-chief-of-staff",
    model: MODELS.sonnet, // reasoning quality matters
  },
  synthesize: {
    intent: "synthesize",
    maxTokens: 4_096,
    deadlineMs: 30_000,
    retries: 1,
    vaultTopK: 10,
    vaultMaxTokens: 6_000,
    messageCap: 20,
    systemAgentId: "ceo-agents-orchestrator",
    model: MODELS.sonnet, // cross-dept synthesis = reasoning
  },
};

export function policyFor(intent: OrchestratorIntent): IntentPolicy {
  return POLICIES[intent];
}
