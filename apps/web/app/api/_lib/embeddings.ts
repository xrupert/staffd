/**
 * Embedding provider — Voyage-3 primary, OpenAI text-embedding-3-large fallback.
 *
 * Same-provider stickiness per call: we attempt Voyage first; on transient
 * failure (network / 5xx / timeout) we retry once, then fall back to OpenAI.
 * The caller learns which provider produced the vector so the Qdrant client
 * can pick the matching collection (vector dimensions differ between
 * providers — 1024 for Voyage, 3072 for OpenAI — so they can't share).
 *
 * Fail-loud: if neither provider succeeds, this throws. Callers (retrieve,
 * ingest) catch and fall through to a vault-less / queued-for-retry path.
 */

import { acquireUpstream, RateLimitedError } from "./vault/ratelimit";

export type EmbeddingProvider = "voyage" | "openai";

export type EmbeddingResult = {
  vector: number[];
  provider: EmbeddingProvider;
  dim: number;
};

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const OPENAI_URL = "https://api.openai.com/v1/embeddings";

const VOYAGE_MODEL = "voyage-3";
const OPENAI_MODEL = "text-embedding-3-large";

const DEFAULT_TIMEOUT_MS = 3_000;

async function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (signal) {
    signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await p;
  } finally {
    clearTimeout(timer);
  }
}

async function callVoyage(input: string, timeoutMs: number): Promise<EmbeddingResult> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY not set");

  // Per-invocation token bucket — throws RateLimitedError synchronously when
  // exhausted. The worker catches this specifically and requeues without
  // incrementing the attempt counter.
  acquireUpstream("voyage");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: [input] }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Voyage ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const vector = data.data?.[0]?.embedding;
    if (!vector?.length) throw new Error("Voyage returned no vector");
    return { vector, provider: "voyage", dim: vector.length };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(input: string, timeoutMs: number): Promise<EmbeddingResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");

  acquireUpstream("openai");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const vector = data.data?.[0]?.embedding;
    if (!vector?.length) throw new Error("OpenAI returned no vector");
    return { vector, provider: "openai", dim: vector.length };
  } finally {
    clearTimeout(timer);
  }
}

const RETRY_DELAYS_MS = [250, 750];

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("aborted") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return true;
    if (/\b(5\d\d|429)\b/.test(msg)) return true;
  }
  return false;
}

/**
 * Produce an embedding. Tries Voyage with up to 2 retries, then OpenAI with
 * up to 2 retries. Throws if both providers exhaust.
 */
export async function embed(
  input: string,
  opts?: { timeoutMs?: number; preferProvider?: EmbeddingProvider }
): Promise<EmbeddingResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prefer = opts?.preferProvider;

  const order: EmbeddingProvider[] = prefer === "openai"
    ? ["openai", "voyage"]
    : ["voyage", "openai"];

  let lastErr: unknown = null;
  for (const provider of order) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return provider === "voyage"
          ? await callVoyage(input, timeoutMs)
          : await callOpenAI(input, timeoutMs);
      } catch (err) {
        lastErr = err;
        // Rate-limit on THIS provider: skip its retries, try the next one.
        // Don't burn retry attempts on a bucket that won't refill in time.
        if (err instanceof RateLimitedError) break;
        if (attempt < RETRY_DELAYS_MS.length && shouldRetry(err)) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        // Non-retryable or out of retries — try next provider.
        break;
      }
    }
  }
  throw lastErr ?? new Error("Embedding failed: no provider succeeded");
}

/** Vector dimension for a given provider — used to pre-size Qdrant collections. */
export function providerDim(provider: EmbeddingProvider): number {
  return provider === "voyage" ? 1024 : 3072;
}

void withTimeout; // reserved for future external-signal use
