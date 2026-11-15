/**
 * Rate limiter for Next.js API routes.
 *
 * Two backends, fixed-window algorithm in both:
 *
 * 1. In-memory (default, `check()`): automatic cleanup of stale entries
 *    to prevent memory leaks in long-running processes.
 *    Limitations (acceptable as fallback):
 *    - In serverless (Vercel), each instance has its own cache, so limits
 *      are per-instance rather than global. This still provides meaningful
 *      protection against abuse from a single client hitting a single instance.
 *    - The cache resets on cold starts.
 *
 * 2. Distributed via Upstash Redis REST (`checkAsync()`): used automatically
 *    when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set.
 *    Counter lives in Redis (INCR + PEXPIRE NX via a single pipeline call,
 *    plain `fetch` — no npm dependency). On any Redis/network error the
 *    limiter falls back to the in-memory implementation (fail-soft).
 *
 * `check()` stays synchronous and in-memory only — existing consumers are
 * unaffected. Use `checkAsync()` in new code to get the distributed backend.
 */

import { logger } from "@/lib/logger";
import { resolveClientIp } from "@/lib/trusted-proxies";

interface RateLimitConfig {
  /** Time window in milliseconds */
  interval: number;
  /** Maximum number of requests allowed per window */
  limit: number;
  /**
   * Redis key namespace for this limiter (used only by the Upstash backend).
   * Defaults to "<interval>:<limit>" so independent limiters don't collide.
   */
  prefix?: string;
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

// ---------------------------------------------------------------------------
// Upstash Redis REST backend (no npm dependency — plain fetch)
// ---------------------------------------------------------------------------

type UpstashPipelineItem = { result?: unknown; error?: string };

/** Read Upstash REST credentials at call time (test/env friendly). */
function getUpstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * Run the fixed-window increment in Upstash via a single REST pipeline call:
 *   INCR key            -> current count in the window
 *   PEXPIRE key <ms> NX -> start the window TTL only on first increment
 *   PTTL key            -> ms until the window resets
 */
async function upstashIncrement(
  upstash: { url: string; token: string },
  redisKey: string,
  intervalMs: number,
): Promise<{ count: number; ttlMs: number }> {
  const res = await fetch(`${upstash.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${upstash.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(intervalMs), "NX"],
      ["PTTL", redisKey],
    ]),
  });

  if (!res.ok) {
    throw new Error(`Upstash pipeline failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as UpstashPipelineItem[];
  const count = Number(data?.[0]?.result);
  if (!Number.isFinite(count)) {
    throw new Error(
      `Upstash INCR failed: ${data?.[0]?.error ?? "invalid response"}`,
    );
  }

  const ttl = Number(data?.[2]?.result);
  return {
    count,
    // PTTL returns -1/-2 when no TTL/no key — treat as a fresh window
    ttlMs: Number.isFinite(ttl) && ttl > 0 ? ttl : intervalMs,
  };
}

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

  const prefix = config.prefix ?? `${config.interval}:${config.limit}`;

  /**
   * Check whether a request identified by `key` is within the rate limit.
   * Synchronous, in-memory backend only.
   *
   * @param key - Unique identifier for the requester (typically IP address)
   * @returns An object indicating success, remaining quota, and reset time
   */
  function check(key: string): RateLimitResult {
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
  }

  /**
   * Distributed variant of `check()`. Uses Upstash Redis (REST) when
   * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are configured;
   * otherwise (or on any Redis error) falls back to the in-memory backend.
   */
  async function checkAsync(key: string): Promise<RateLimitResult> {
    const upstash = getUpstashConfig();
    if (!upstash) return check(key);

    try {
      const { count, ttlMs } = await upstashIncrement(
        upstash,
        `rl:${prefix}:${key}`,
        config.interval,
      );

      return {
        success: count <= config.limit && config.limit >= 1,
        remaining: Math.max(0, config.limit - count),
        reset: ttlMs,
      };
    } catch (error) {
      logger.warn("[RateLimit] Upstash error — falling back to in-memory", {
        error,
      });
      return check(key);
    }
  }

  return {
    check,
    checkAsync,

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
export const apiRateLimit = createRateLimit({
  interval: 60_000,
  limit: 60,
  prefix: "api",
});

/** Auth-related rate limit: 10 requests per minute */
export const authRateLimit = createRateLimit({
  interval: 60_000,
  limit: 10,
  prefix: "auth",
});

/** Strict rate limit for sensitive operations: 5 requests per minute */
export const strictRateLimit = createRateLimit({
  interval: 60_000,
  limit: 5,
  prefix: "strict",
});

/** AI endpoints rate limit: 30 requests per minute (keyed per salon) */
export const aiRateLimit = createRateLimit({
  interval: 60_000,
  limit: 30,
  prefix: "ai",
});

// ---------------------------------------------------------------------------
// Helper for extracting the client IP from a Request
// ---------------------------------------------------------------------------

/**
 * Extract the client IP address from request headers.
 *
 * Logic lives in src/lib/trusted-proxies.ts (`resolveClientIp`) and is shared
 * with Better Auth's `advanced.ipAddress` (same headers, same trusted proxies):
 *
 * - Vercel (VERCEL=1): `x-real-ip` set by Vercel Proxy, X-Forwarded-For only
 *   as a fallback.
 * - Elsewhere (local, GCP): X-Forwarded-For, first entry from the right that
 *   is not a trusted proxy (env TRUSTED_PROXIES). The leftmost entry is
 *   client-written and spoofable, so it is never preferred. `x-real-ip` is
 *   NOT used — a client can set it.
 *
 * Falls back to "unknown" (a shared bucket for requests without an
 * identifiable IP).
 */
export function getClientIp(request: Request): string {
  return resolveClientIp(request.headers) ?? "unknown";
}
