import type { Context, Next } from "hono";

const RATE_LIMIT_MAX = 50;
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24h in ms

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

/**
 * Rate limit middleware — reads userId from context (set by auth middleware)
 * or falls back to IP address.
 */
export function rateLimitMiddleware(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  const ip = c.req.header("x-forwarded-for") ?? "anonymous";
  const key = userId ?? ip;

  const { allowed, remaining } = checkRateLimit(key);

  if (!allowed) {
    return c.json(
      { error: "Daily generation limit reached. Limit resets in 24 hours." },
      429,
      { "X-RateLimit-Remaining": "0" }
    );
  }

  c.res.headers.set("X-RateLimit-Remaining", String(remaining));
  return next();
}
