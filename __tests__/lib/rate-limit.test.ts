import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createRateLimit,
  apiRateLimit,
  authRateLimit,
  strictRateLimit,
  getClientIp,
} from "@/lib/rate-limit";

describe("createRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow requests within the limit", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 3 });

    const r1 = limiter.check("user-1");
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("user-1");
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("user-1");
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("should reject requests exceeding the limit", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 2 });

    limiter.check("user-1");
    limiter.check("user-1");
    const r3 = limiter.check("user-1");

    expect(r3.success).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("should return the correct reset time", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 5 });

    const r1 = limiter.check("user-1");
    expect(r1.reset).toBe(60_000);

    // Advance time by 20 seconds within the window
    vi.advanceTimersByTime(20_000);

    const r2 = limiter.check("user-1");
    expect(r2.reset).toBe(40_000);
  });

  it("should reset the window after the interval expires", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 1 });

    const r1 = limiter.check("user-1");
    expect(r1.success).toBe(true);

    const r2 = limiter.check("user-1");
    expect(r2.success).toBe(false);

    // Fast forward past the interval
    vi.advanceTimersByTime(60_000);

    const r3 = limiter.check("user-1");
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0); // limit is 1, so after 1 request remaining is 0
  });

  it("should track different keys independently", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 1 });

    const r1 = limiter.check("user-1");
    expect(r1.success).toBe(true);

    // user-1 is exhausted
    const r2 = limiter.check("user-1");
    expect(r2.success).toBe(false);

    // user-2 should still be allowed
    const r3 = limiter.check("user-2");
    expect(r3.success).toBe(true);
  });

  it("should report the reset time on rejected requests", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 1 });

    limiter.check("user-1");

    vi.advanceTimersByTime(30_000);

    const rejected = limiter.check("user-1");
    expect(rejected.success).toBe(false);
    expect(rejected.reset).toBe(30_000);
  });

  it("should clean up stale entries via the periodic timer", () => {
    const limiter = createRateLimit({ interval: 10_000, limit: 5 });

    limiter.check("user-1");
    limiter.check("user-2");
    expect(limiter.size).toBe(2);

    // Advance past the interval so entries become stale
    vi.advanceTimersByTime(10_000);

    // Advance past the cleanup interval (60s) to trigger the sweep
    vi.advanceTimersByTime(60_000);

    expect(limiter.size).toBe(0);
  });

  it("should reset all entries when reset() is called", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 1 });

    limiter.check("user-1");
    limiter.check("user-2");
    expect(limiter.size).toBe(2);

    limiter.reset();
    expect(limiter.size).toBe(0);

    // After reset, user-1 should be allowed again
    const result = limiter.check("user-1");
    expect(result.success).toBe(true);
  });

  it("should handle a limit of 0 by rejecting all requests", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 0 });

    const result = limiter.check("user-1");
    // First request: count becomes 1, which exceeds limit of 0
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should allow burst traffic up to the limit then reject", () => {
    const limiter = createRateLimit({ interval: 60_000, limit: 5 });

    // Rapid burst of 5 requests
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("burst-user").success).toBe(true);
    }

    // 6th request should be rejected
    expect(limiter.check("burst-user").success).toBe(false);
  });
});

describe("pre-configured limiters", () => {
  beforeEach(() => {
    // Reset the singleton limiters between tests to avoid cross-test pollution
    apiRateLimit.reset();
    authRateLimit.reset();
    strictRateLimit.reset();
  });

  it("apiRateLimit should allow 60 requests per minute", () => {
    for (let i = 0; i < 60; i++) {
      expect(apiRateLimit.check("test-ip").success).toBe(true);
    }
    expect(apiRateLimit.check("test-ip").success).toBe(false);
  });

  it("authRateLimit should allow 10 requests per minute", () => {
    for (let i = 0; i < 10; i++) {
      expect(authRateLimit.check("test-ip").success).toBe(true);
    }
    expect(authRateLimit.check("test-ip").success).toBe(false);
  });

  it("strictRateLimit should allow 5 requests per minute", () => {
    for (let i = 0; i < 5; i++) {
      expect(strictRateLimit.check("test-ip").success).toBe(true);
    }
    expect(strictRateLimit.check("test-ip").success).toBe(false);
  });
});

describe("getClientIp", () => {
  it("should extract IP from x-forwarded-for header", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18" },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });

  it("should extract IP from x-real-ip header when x-forwarded-for is absent", () => {
    const request = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.10" },
    });
    expect(getClientIp(request)).toBe("198.51.100.10");
  });

  it("should return 'unknown' when no IP headers are present", () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("unknown");
  });

  it("should prefer x-forwarded-for over x-real-ip", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "203.0.113.50",
        "x-real-ip": "198.51.100.10",
      },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });

  it("should trim whitespace from x-forwarded-for first entry", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "  203.0.113.50  , 70.41.3.18" },
    });
    expect(getClientIp(request)).toBe("203.0.113.50");
  });
});
