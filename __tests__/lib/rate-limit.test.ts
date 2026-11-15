import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createRateLimit,
  apiRateLimit,
  authRateLimit,
  strictRateLimit,
  aiRateLimit,
  getClientIp,
} from "@/lib/rate-limit";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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

  it("aiRateLimit should allow 30 requests per minute", () => {
    aiRateLimit.reset();
    for (let i = 0; i < 30; i++) {
      expect(aiRateLimit.check("salon:abc").success).toBe(true);
    }
    expect(aiRateLimit.check("salon:abc").success).toBe(false);
  });
});

describe("checkAsync (Upstash adapter)", () => {
  const UPSTASH_URL = "https://test-redis.upstash.io";
  const UPSTASH_TOKEN = "test-token";

  /** Build a fetch mock returning an Upstash pipeline response. */
  function mockUpstashFetch(
    items: Array<{ result?: unknown; error?: string }>,
    ok = true,
    status = 200,
  ) {
    return vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => items,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("should fall back to in-memory when Upstash env is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const limiter = createRateLimit({ interval: 60_000, limit: 2 });

    const r1 = await limiter.checkAsync("user-1");
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(1);

    await limiter.checkAsync("user-1");
    const r3 = await limiter.checkAsync("user-1");
    expect(r3.success).toBe(false);

    // Redis must not have been touched
    expect(fetchMock).not.toHaveBeenCalled();
    // The in-memory cache tracked the key
    expect(limiter.size).toBe(1);
  });

  it("should use the Upstash pipeline when env is configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
    const fetchMock = mockUpstashFetch([
      { result: 1 },
      { result: 1 },
      { result: 60_000 },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const limiter = createRateLimit({
      interval: 60_000,
      limit: 30,
      prefix: "ai",
    });

    const result = await limiter.checkAsync("salon:abc");
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(29);
    expect(result.reset).toBe(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(`${UPSTASH_URL}/pipeline`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${UPSTASH_TOKEN}`);

    const body = JSON.parse(init.body);
    expect(body).toEqual([
      ["INCR", "rl:ai:salon:abc"],
      ["PEXPIRE", "rl:ai:salon:abc", "60000", "NX"],
      ["PTTL", "rl:ai:salon:abc"],
    ]);

    // The in-memory cache must not be used on the Redis path
    expect(limiter.size).toBe(0);
  });

  it("should reject when the Redis counter exceeds the limit", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
    vi.stubGlobal(
      "fetch",
      mockUpstashFetch([{ result: 31 }, { result: 0 }, { result: 42_000 }]),
    );

    const limiter = createRateLimit({ interval: 60_000, limit: 30 });

    const result = await limiter.checkAsync("salon:abc");
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reset).toBe(42_000);
  });

  it("should treat missing TTL (-1) as a fresh window", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
    vi.stubGlobal(
      "fetch",
      mockUpstashFetch([{ result: 1 }, { result: 1 }, { result: -1 }]),
    );

    const limiter = createRateLimit({ interval: 60_000, limit: 5 });

    const result = await limiter.checkAsync("user-1");
    expect(result.success).toBe(true);
    expect(result.reset).toBe(60_000);
  });

  it("should fall back to in-memory when the fetch call fails", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const limiter = createRateLimit({ interval: 60_000, limit: 1 });

    const r1 = await limiter.checkAsync("user-1");
    expect(r1.success).toBe(true);

    const r2 = await limiter.checkAsync("user-1");
    expect(r2.success).toBe(false);

    // Both requests were served by the in-memory fallback
    expect(limiter.size).toBe(1);
  });

  it("should fall back to in-memory on a non-OK HTTP response", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
    vi.stubGlobal("fetch", mockUpstashFetch([], false, 500));

    const limiter = createRateLimit({ interval: 60_000, limit: 3 });

    const result = await limiter.checkAsync("user-1");
    expect(result.success).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("should strip trailing slashes from the Upstash URL", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", `${UPSTASH_URL}/`);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH_TOKEN);
    const fetchMock = mockUpstashFetch([
      { result: 1 },
      { result: 1 },
      { result: 60_000 },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const limiter = createRateLimit({ interval: 60_000, limit: 3 });
    await limiter.checkAsync("user-1");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${UPSTASH_URL}/pipeline`);
  });
});

describe("getClientIp", () => {
  const originalTrusted = process.env.TRUSTED_PROXIES;
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    delete process.env.TRUSTED_PROXIES;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    if (originalTrusted === undefined) delete process.env.TRUSTED_PROXIES;
    else process.env.TRUSTED_PROXIES = originalTrusted;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  const req = (headers: Record<string, string>) => new Request("http://localhost", { headers });

  describe("poza Vercelem (lokalnie, GCP)", () => {
    it("should extract a single-value x-forwarded-for unchanged", () => {
      expect(getClientIp(req({ "x-forwarded-for": "203.0.113.50" }))).toBe("203.0.113.50");
    });

    it("should trim whitespace from x-forwarded-for entries", () => {
      expect(getClientIp(req({ "x-forwarded-for": "  203.0.113.50  " }))).toBe("203.0.113.50");
    });

    it("should NOT trust the spoofable leftmost x-forwarded-for entry (no trusted proxies)", () => {
      // Lewy wpis wpisuje klient — wcześniej wygrywał i pozwalał obejść limit.
      expect(getClientIp(req({ "x-forwarded-for": "203.0.113.50, 70.41.3.18" }))).toBe("70.41.3.18");
    });

    it("should skip trusted proxies from TRUSTED_PROXIES and return the first untrusted hop from the right", () => {
      process.env.TRUSTED_PROXIES = "34.120.10.5,35.191.0.0/16";
      expect(
        getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.50, 34.120.10.5, 35.191.1.2" }))
      ).toBe("203.0.113.50");
    });

    it("should ignore broad private ranges in TRUSTED_PROXIES (10.0.0.0/8)", () => {
      process.env.TRUSTED_PROXIES = "10.0.0.0/8";
      // 10/8 odrzucone → lista pusta → prawy wpis, a nie podrobiony lewy
      expect(getClientIp(req({ "x-forwarded-for": "203.0.113.50, 10.1.2.3" }))).toBe("10.1.2.3");
    });

    it("should IGNORE client-supplied x-real-ip (no XFF → 'unknown')", () => {
      expect(getClientIp(req({ "x-real-ip": "198.51.100.10" }))).toBe("unknown");
    });

    it("should IGNORE x-real-ip when x-forwarded-for is empty", () => {
      expect(getClientIp(req({ "x-forwarded-for": " , ", "x-real-ip": "198.51.100.10" }))).toBe(
        "unknown"
      );
    });

    it("should prefer x-forwarded-for over x-real-ip", () => {
      expect(
        getClientIp(req({ "x-forwarded-for": "203.0.113.50", "x-real-ip": "198.51.100.10" }))
      ).toBe("203.0.113.50");
    });

    it("should return 'unknown' when no IP headers are present", () => {
      expect(getClientIp(req({}))).toBe("unknown");
    });
  });

  describe("na Vercelu (VERCEL=1)", () => {
    beforeEach(() => {
      process.env.VERCEL = "1";
    });

    it("should use x-real-ip (set by Vercel Proxy) even when XFF is a chain 'a, b'", () => {
      expect(
        getClientIp(req({ "x-forwarded-for": "6.6.6.6, 76.76.21.1", "x-real-ip": "203.0.113.50" }))
      ).toBe("203.0.113.50");
    });

    it("should use x-real-ip when XFF has the same single value (today's Vercel)", () => {
      expect(
        getClientIp(req({ "x-forwarded-for": "203.0.113.50", "x-real-ip": "203.0.113.50" }))
      ).toBe("203.0.113.50");
    });

    it("should fall back to XFF (right-to-left) when x-real-ip is missing or empty", () => {
      expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.50" }))).toBe("203.0.113.50");
      expect(getClientIp(req({ "x-forwarded-for": "203.0.113.50", "x-real-ip": "  " }))).toBe(
        "203.0.113.50"
      );
    });

    it("should skip an invalid x-real-ip and use XFF (same as Better Auth)", () => {
      expect(
        getClientIp(req({ "x-forwarded-for": "203.0.113.50", "x-real-ip": "not-an-ip" }))
      ).toBe("203.0.113.50");
    });

    it("should return 'unknown' when no IP headers are present", () => {
      expect(getClientIp(req({}))).toBe("unknown");
    });

    it("VERCEL other than '1' is treated as non-Vercel", () => {
      process.env.VERCEL = "true";
      expect(getClientIp(req({ "x-real-ip": "198.51.100.10" }))).toBe("unknown");
    });
  });
});
