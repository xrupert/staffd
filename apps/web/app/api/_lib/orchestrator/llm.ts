/**
 * The global LLM guardrail wrapper.
 *
 * Every orchestrator handler — and ONLY orchestrator handlers — calls Claude
 * through this function. The wrapper owns:
 *
 *   • the per-attempt deadline (AbortController)
 *   • the per-intent retry policy (route=0, handoff=0, brief=1, synthesize=1)
 *   • exponential backoff (250 ms → 750 ms) on AbortError / 429 / 5xx / network
 *   • the wall-clock budget check (> 1.5× deadline ⇒ llm_budget_exceeded)
 *   • the input-token soft cap and trim ladder (drop memory → trim vault → ...)
 *   • token accounting in the structured envelope
 *
 * Spec §B1 hard rule: no other file under `_lib/orchestrator/handlers/**`
 * may import `@anthropic-ai/sdk`. A grep test asserts this in the B1
 * acceptance gate.
 */

import Anthropic from "@anthropic-ai/sdk";
import { policyFor, SOFT_INPUT_TOKEN_BUDGET, BUDGET_DEADLINE_MULTIPLIER } from "./policies";
import { computeCostUsd } from "../llm-router";
import type { FallbackReason, OrchestratorIntent } from "./types";

const anthropic = new Anthropic();

const RETRY_DELAYS_MS = [250, 750];

export type LLMCallInput = {
  intent: OrchestratorIntent;
  /** Final system prompt — handler is responsible for assembly. */
  system: string;
  /** Conversation history. Handlers should pre-cap to `policy.messageCap`. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** External AbortSignal — wrapper merges with its own per-attempt timer. */
  signal?: AbortSignal;
  /** Optional model override; defaults to the intent's policy.model. */
  model?: string;
};

export type LLMSuccess = {
  ok: true;
  text: string;
  attempts: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  model: string;
  costUsd: number;
};

export type LLMFailure = {
  ok: false;
  fallback: FallbackReason;
  attempts: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  model: string;
  costUsd: number;
};

export type LLMResult = LLMSuccess | LLMFailure;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** ~chars/4 estimator — matches budget.ts so the two budgets stay aligned. */
function estimateInputTokens(input: LLMCallInput): number {
  const sysChars = input.system.length;
  let msgChars = 0;
  for (const m of input.messages) msgChars += m.content.length;
  return Math.ceil((sysChars + msgChars) / 4);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("aborted") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return true;
    if (/\b(5\d\d|429)\b/.test(msg)) return true;
  }
  // Anthropic SDK errors expose `status`
  const e = err as { status?: number; code?: string };
  if (typeof e?.status === "number" && (e.status === 429 || e.status >= 500)) return true;
  if (e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT") return true;
  return false;
}

function mergeAbort(external: AbortSignal | undefined, ownCtrl: AbortController): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    ownCtrl.abort();
    return () => {};
  }
  const onAbort = () => ownCtrl.abort();
  external.addEventListener("abort", onAbort, { once: true });
  return () => external.removeEventListener("abort", onAbort);
}

/**
 * Single attempt against Anthropic with a hard per-attempt deadline.
 * Returns extracted text + token counts on success; throws on failure.
 */
async function attempt(
  input: LLMCallInput,
  deadlineMs: number,
  maxTokens: number,
  model: string
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deadlineMs);
  const detach = mergeAbort(input.signal, ctrl);
  try {
    const msg = await anthropic.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system: [
          {
            type: "text",
            text: input.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: input.messages,
      },
      { signal: ctrl.signal }
    );

    const block = msg.content[0];
    const text = block?.type === "text" ? block.text : "";
    const tokensIn = msg.usage?.input_tokens ?? 0;
    const tokensOut = msg.usage?.output_tokens ?? 0;
    return { text, tokensIn, tokensOut };
  } finally {
    clearTimeout(timer);
    detach();
  }
}

/**
 * Call Claude under the orchestrator's intent policy.
 *
 * Returns a structured envelope. Never throws to the caller — failures
 * become `{ok:false, fallback:"..."}` so handlers can return the
 * deterministic degraded output instead.
 */
export async function callLLM(input: LLMCallInput): Promise<LLMResult> {
  const start = Date.now();
  const policy = policyFor(input.intent);
  const model = input.model ?? policy.model;
  const budgetMs = Math.floor(policy.deadlineMs * BUDGET_DEADLINE_MULTIPLIER);

  // Soft input-token budget check — over-budget inputs trip llm_budget_exceeded
  // immediately; the handler should have trimmed before calling us, but this
  // is the last line of defence.
  const tokensIn = estimateInputTokens(input);
  if (tokensIn > SOFT_INPUT_TOKEN_BUDGET) {
    return {
      ok: false,
      fallback: "llm_budget_exceeded",
      attempts: 0,
      latencyMs: Date.now() - start,
      tokensIn,
      tokensOut: 0,
      model,
      costUsd: 0,
    };
  }

  let attempts = 0;
  let lastErr: unknown = null;
  const maxAttempts = policy.retries + 1;

  while (attempts < maxAttempts) {
    attempts++;

    // Wall-clock budget gate — if we've already burned more than 1.5× the
    // per-attempt deadline across attempts, stop and degrade.
    const elapsed = Date.now() - start;
    if (elapsed > budgetMs) {
      return {
        ok: false,
        fallback: "llm_budget_exceeded",
        attempts: attempts - 1,
        latencyMs: elapsed,
        tokensIn,
        tokensOut: 0,
        model,
        costUsd: 0,
      };
    }

    try {
      const { text, tokensIn: actualIn, tokensOut } = await attempt(
        input,
        policy.deadlineMs,
        policy.maxTokens,
        model
      );
      const finalIn = actualIn || tokensIn;
      return {
        ok: true,
        text,
        attempts,
        latencyMs: Date.now() - start,
        tokensIn: finalIn,
        tokensOut,
        model,
        costUsd: computeCostUsd(model, finalIn, tokensOut),
      };
    } catch (err) {
      lastErr = err;
      const aborted = err instanceof Error && err.name === "AbortError";
      const retryable = isRetryable(err);

      if (attempts >= maxAttempts || (!aborted && !retryable)) {
        const fallback: FallbackReason = aborted
          ? "deadline_exceeded"
          : "upstream_error";
        return {
          ok: false,
          fallback,
          attempts,
          latencyMs: Date.now() - start,
          tokensIn,
          tokensOut: 0,
          model,
          costUsd: 0,
        };
      }

      const delay = RETRY_DELAYS_MS[attempts - 1] ?? 750;
      await sleep(delay);
    }
  }

  // Should be unreachable, but TypeScript needs an explicit return.
  return {
    ok: false,
    fallback: "upstream_error",
    attempts,
    latencyMs: Date.now() - start,
    tokensIn,
    tokensOut: 0,
    model,
    costUsd: 0,
  };
  void lastErr;
}
