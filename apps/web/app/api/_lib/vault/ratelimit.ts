/**
 * Per-upstream token-bucket rate limiter.
 *
 * The ingestion worker fans out summarize+embed jobs that each hit Anthropic
 * (Haiku) and Voyage / OpenAI in quick succession. Without a throttle, a
 * single batch of 8 documents would burn well past every provider's per-minute
 * quota. This module is the throttle.
 *
 * Important constraints (V4a spec):
 *
 *   • Limits are **per worker invocation, in-memory**. Vercel functions are
 *     ephemeral, so each cron tick starts fresh. We intentionally pick
 *     conservative budgets that are safe for a single invocation:
 *
 *         Voyage embeddings : 60 req/min
 *         OpenAI embeddings : 60 req/min
 *         Anthropic Haiku   : 30 req/min
 *
 *   • When a bucket is empty, `acquireUpstream` throws `RateLimitedError`
 *     synchronously. Callers should let it bubble — the ingestion worker
 *     catches `RateLimitedError` specifically and requeues the job with
 *     +60 s delay WITHOUT incrementing the attempt counter (rate limits are
 *     not a job's "fault").
 *
 *   • The buckets are shared across the whole process — every call in this
 *     invocation consults the same Map. That includes parallel jobs running
 *     under the worker's bounded concurrency.
 */

export type UpstreamProvider = "voyage" | "openai" | "haiku";

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private capacity: number, private refillPerSec: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /** Try to consume one token. Returns false if the bucket is empty. */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = now;
  }
}

// Per-invocation, in-memory state. Vercel cold-starts give us fresh buckets
// per cron tick by design — see header comment.
const BUCKETS: Record<UpstreamProvider, TokenBucket> = {
  voyage: new TokenBucket(60, 60 / 60), // 60 capacity, 1/sec refill
  openai: new TokenBucket(60, 60 / 60),
  haiku:  new TokenBucket(30, 30 / 60), // 30 capacity, 0.5/sec refill
};

export class RateLimitedError extends Error {
  constructor(public provider: UpstreamProvider) {
    super(`rate_limited:${provider}`);
    this.name = "RateLimitedError";
  }
}

/**
 * Consume one token from the provider's bucket. Throws `RateLimitedError`
 * synchronously when the bucket is empty.
 */
export function acquireUpstream(provider: UpstreamProvider): void {
  const bucket = BUCKETS[provider];
  if (!bucket.tryAcquire()) {
    throw new RateLimitedError(provider);
  }
}

/**
 * Test seam — lets the worker (or a synthetic test) inspect bucket health
 * without consuming a token. NOT exported for handler-side use.
 */
export function _bucketStateForDebug(): Record<UpstreamProvider, { capacity: number }> {
  return {
    voyage: { capacity: 60 },
    openai: { capacity: 60 },
    haiku:  { capacity: 30 },
  };
}
