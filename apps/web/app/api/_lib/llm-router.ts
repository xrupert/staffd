/**
 * Model routing — `pickModel()` decides which LLM handles a given call.
 *
 * The cost wedge:
 *
 *   Sonnet 4.6   $3.00 in / $15.00 out per Mtok  — reasoning, long-form, legal/finance
 *   Haiku 4.5    $1.00 in /  $5.00 out per Mtok  — routing, handoff, summaries, short-form
 *   Llama 70B    $0.59 in /  $0.79 out per Mtok  — short captions when GROQ_API_KEY set
 *
 * Routing rules (locked):
 *
 *   1. Department override
 *        legal | finance | operations → ALWAYS Sonnet (no cost savings worth
 *        a quality regression on contracts, P&Ls, or SOPs).
 *   2. Intent override (orchestrator calls)
 *        brief | synthesize → Sonnet (reasoning + structure quality)
 *        route  | handoff   → Haiku (fast, cheap, deterministic)
 *   3. Task heuristics (doc generation, no intent)
 *        Matches a short-form keyword OR task text < 80 chars → short-form bucket
 *        Short-form bucket → Groq Llama if GROQ_API_KEY set, else Haiku
 *        Otherwise → Sonnet
 *
 *  All callers thread the returned `ModelChoice` through the LLM wrapper /
 *  Anthropic SDK / Groq invoker. Cost is logged downstream via
 *  `computeCostUsd(model, tokensIn, tokensOut)`.
 */

import type { OrchestratorIntent } from "./orchestrator/types";

export type LLMProvider = "anthropic" | "groq";
export type LLMFamily = "sonnet" | "haiku" | "llama";

export type ModelChoice = {
  provider: LLMProvider;
  model: string;
  family: LLMFamily;
  /** Short human-readable reason this model was picked — surfaced in logs. */
  reason: string;
};

// ──────────────────────────────────────────────────────────────────────────
// Model names + prices
// ──────────────────────────────────────────────────────────────────────────

export const MODELS = {
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001",
  llama:  "llama-3.1-70b-versatile",
} as const;

/** USD per million tokens. Update when provider pricing changes. */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  [MODELS.sonnet]: { input: 3.0, output: 15.0 },
  [MODELS.haiku]:  { input: 1.0, output:  5.0 },
  [MODELS.llama]:  { input: 0.59, output: 0.79 },
};

/**
 * Returns estimated cost in USD for a single call. Returns 0 for unknown
 * models so the call site doesn't fail when pricing data is stale.
 */
export function computeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICES_USD_PER_MTOK[model];
  if (!p) return 0;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}

// ──────────────────────────────────────────────────────────────────────────
// pickModel
// ──────────────────────────────────────────────────────────────────────────

/**
 * Departments that always require Sonnet — institutional voice, formal
 * conventions, or numerically/legally sensitive output.
 */
const REASONING_REQUIRED_DEPTS = new Set<string>([
  "legal",
  "finance",
  "operations",
]);

/**
 * Lexical signals that the task is short-form (caption, reply, headline,
 * tweet, etc.). When matched, we route to the cheap tier.
 */
const SHORT_FORM_KEYWORDS = /\b(caption|tweet|reply|response|comment|sms|notification|tagline|headline|subject line|push\b|alt text|microcopy|cta|hashtag)\b/i;
const SHORT_TASK_CHAR_THRESHOLD = 80;

export type PickModelInput = {
  intent?: OrchestratorIntent;
  department?: string;
  agentId?: string;
  task?: string;
  /** When the caller already knows the output will be short — overrides task heuristics. */
  expectedShortForm?: boolean;
};

export function pickModel(input: PickModelInput): ModelChoice {
  const { intent, department, task, expectedShortForm } = input;

  // 1. Department override — always Sonnet for reasoning-required depts.
  if (department && REASONING_REQUIRED_DEPTS.has(department)) {
    return sonnet(`dept=${department} requires reasoning`);
  }

  // 2. Intent override — orchestrator workloads have locked tiers.
  if (intent === "brief" || intent === "synthesize") {
    return sonnet(`intent=${intent} requires reasoning`);
  }
  if (intent === "route" || intent === "handoff") {
    return haiku(`intent=${intent} is short + deterministic`);
  }

  // 3. Task heuristics — short-form bucket routes to cheap tier.
  const taskText = (task ?? "").trim();
  const isShortByKeyword = taskText && SHORT_FORM_KEYWORDS.test(taskText);
  const isShortByLength = taskText && taskText.length < SHORT_TASK_CHAR_THRESHOLD;
  const isShortForm = expectedShortForm === true || isShortByKeyword || isShortByLength;

  if (isShortForm) {
    if (process.env.GROQ_API_KEY) {
      return llama(`short-form, GROQ_API_KEY available`);
    }
    return haiku(`short-form fallback (no GROQ)`);
  }

  // 4. Default — Sonnet for full-quality long-form.
  return sonnet(`default long-form`);
}

function sonnet(reason: string): ModelChoice {
  return { provider: "anthropic", model: MODELS.sonnet, family: "sonnet", reason };
}
function haiku(reason: string): ModelChoice {
  return { provider: "anthropic", model: MODELS.haiku, family: "haiku", reason };
}
function llama(reason: string): ModelChoice {
  return { provider: "groq", model: MODELS.llama, family: "llama", reason };
}

// ──────────────────────────────────────────────────────────────────────────
// Groq invoker (non-streaming) — used by agent route for short-form when
// GROQ_API_KEY is set. Anthropic continues to use its streaming SDK path.
// ──────────────────────────────────────────────────────────────────────────

export type GroqResult = { text: string; tokensIn: number; tokensOut: number };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function callGroq(
  model: string,
  system: string,
  userMessage: string,
  maxTokens: number,
  signal?: AbortSignal
): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: userMessage },
      ],
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return { text, tokensIn, tokensOut };
}
