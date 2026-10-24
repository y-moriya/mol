import type { MiddlewareHandler } from "hono";

interface RateLimitRecord {
  count: number;
  resetAtEpochMs: number;
}

export function createSlidingWindowRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly keyPrefix?: string;
}): MiddlewareHandler {
  const store = new Map<string, RateLimitRecord>();
  const prefix = options.keyPrefix ?? "rl";

  return async (c, next) => {
    const now = Date.now();
    const rawIp =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("x-real-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "127.0.0.1";

    const key = `${prefix}:${rawIp}`;

    // Periodic cleanup of expired entries (probabilistic 5%)
    if (Math.random() < 0.05) {
      for (const [k, v] of store.entries()) {
        if (v.resetAtEpochMs <= now) {
          store.delete(k);
        }
      }
    }

    const current = store.get(key);
    if (!current || current.resetAtEpochMs <= now) {
      store.set(key, { count: 1, resetAtEpochMs: now + options.windowMs });
      c.header("X-RateLimit-Limit", String(options.limit));
      c.header("X-RateLimit-Remaining", String(options.limit - 1));
      await next();
      return;
    }

    if (current.count >= options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAtEpochMs - now) / 1000));
      c.header("Retry-After", String(retryAfterSeconds));
      c.header("X-RateLimit-Limit", String(options.limit));
      c.header("X-RateLimit-Remaining", "0");
      return c.json(
        {
          error: "too_many_requests",
          message: "Rate limit exceeded. Please wait before retrying.",
          retry_after_seconds: retryAfterSeconds,
        },
        429,
      );
    }

    current.count += 1;
    store.set(key, current);
    c.header("X-RateLimit-Limit", String(options.limit));
    c.header("X-RateLimit-Remaining", String(options.limit - current.count));
    await next();
  };
}
