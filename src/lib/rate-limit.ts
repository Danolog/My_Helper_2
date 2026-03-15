/**
 * In-memory rate limiter for Next.js API routes.
 *
 * Uses a fixed-window algorithm with automatic cleanup of stale entries
 * to prevent memory leaks in long-running processes.
 *
 * Limitations (acceptable for now):
 * - In serverless (Vercel), each instance has its own cache, so limits
 *   are per-instance rather than global. This still provides meaningful
 *   protection against abuse from a single client hitting a single instance.
 * - The cache resets on cold starts.
 *
 * For production-grade distributed rate limiting, migrate to Redis/Upstash.
 */

interface RateLimitConfig {
  /** Time window in milliseconds */
  interval: number;
  /** Maximum number of requests allowed per window */
  limit: number;
}

interface RateLimitEntry {
  count: number;
  /** Timestamp (ms) when the current window started */
  windowStart: number;
}

interface RateLimitResult {
  /** Whether the request is allowed */
  success: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Milliseconds until the current window resets */
  reset: number;
}

/**
 * Interval (ms) between automatic sweeps of stale entries.
 * Runs every 60 seconds to remove entries whose window has expired.
 */
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Create a rate limiter instance with the given configuration.
 *
 * Each call creates an independent limiter with its own cache,
 * suitable for different tiers (general API, auth, strict/sensitive).
 */
export function createRateLimit(config: RateLimitConfig) {
  const cache = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent unbounded memory growth.
  // Using unref() so the timer does not prevent Node.js from exiting.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.windowStart >= config.interval) {
        cache.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the process to exit even if the timer is still pending
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }

  return {
    /**
     * Check whether a request identified by `key` is within the rate limit.
     *
     * @param key - Unique identifier for the requester (typically IP address)
     * @returns An object indicating success, remaining quota, and reset time
     */
    check(key: string): RateLimitResult {
      const now = Date.now();
      const entry = cache.get(key);

      // No existing entry or window has expired -- start a fresh window
      if (!entry || now - entry.windowStart >= config.interval) {
        cache.set(key, { count: 1, windowStart: now });

        // Handle edge case where limit is 0 (reject all requests)
        if (config.limit < 1) {
          return {
            success: false,
            remaining: 0,
            reset: config.interval,
          };
        }

        return {
          success: true,
          remaining: config.limit - 1,
          reset: config.interval,
        };
      }

      // Within the current window -- increment and check
      entry.count += 1;

      const timeElapsed = now - entry.windowStart;
      const timeRemaining = config.interval - timeElapsed;

      if (entry.count > config.limit) {
        return {
          success: false,
          remaining: 0,
          reset: timeRemaining,
        };
      }

      return {
        success: true,
        remaining: config.limit - entry.count,
        reset: timeRemaining,
      };
    },

    /**
     * Manually clear all entries. Useful for testing.
     */
    reset() {
      cache.clear();
    },

    /**
     * Return the current number of tracked keys. Useful for monitoring.
     */
    get size() {
      return cache.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-configured limiter instances (module-level singletons)
// ---------------------------------------------------------------------------

/** General API rate limit: 60 requests per minute */
export const apiRateLimit = createRateLimit({ interval: 60_000, limit: 60 });

/** Auth-related rate limit: 10 requests per minute */
export const authRateLimit = createRateLimit({ interval: 60_000, limit: 10 });

/** Strict rate limit for sensitive operations: 5 requests per minute */
export const strictRateLimit = createRateLimit({ interval: 60_000, limit: 5 });

// ---------------------------------------------------------------------------
// Helper for extracting the client IP from a Request
// ---------------------------------------------------------------------------

/**
 * Extract the client IP address from request headers.
 *
 * Checks headers in order of reliability for proxied environments
 * (Vercel, Cloudflare, nginx). Falls back to "unknown" which still
 * provides a shared bucket for requests without identifiable IPs.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
