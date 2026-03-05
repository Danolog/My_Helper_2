import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getServerEnv, getClientEnv, checkEnv } from "@/lib/env";

describe("getServerEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh copy for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return valid server env when all required vars are set", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    (process.env as Record<string, string>).NODE_ENV = "test";

    const env = getServerEnv();
    expect(env.POSTGRES_URL).toBe("postgresql://localhost:5432/test");
    expect(env.BETTER_AUTH_SECRET).toBe("a".repeat(32));
  });

  it("should throw when POSTGRES_URL is missing", () => {
    delete process.env.POSTGRES_URL;
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => getServerEnv()).toThrow("Invalid server environment variables");
  });

  it("should throw when BETTER_AUTH_SECRET is too short", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "short";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => getServerEnv()).toThrow("Invalid server environment variables");
  });

  it("should use default values for optional fields", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    (process.env as Record<string, string>).NODE_ENV = "test";

    const env = getServerEnv();
    expect(env.OPENROUTER_MODEL).toBe("anthropic/claude-sonnet-4");
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("should accept valid NODE_ENV values", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);

    for (const nodeEnv of ["development", "production", "test"]) {
      (process.env as Record<string, string>).NODE_ENV = nodeEnv;
      const env = getServerEnv();
      expect(env.NODE_ENV).toBe(nodeEnv);
    }
  });
});

describe("getClientEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default NEXT_PUBLIC_APP_URL when not set", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const env = getClientEnv();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("should return custom NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://myhelper.pl";
    const env = getClientEnv();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://myhelper.pl");
  });

  it("should include optional VAPID public key", () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-vapid-key";
    const env = getClientEnv();
    expect(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY).toBe("test-vapid-key");
  });

  it("should include optional Stripe publishable key", () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_123";
    const env = getClientEnv();
    expect(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe("pk_test_123");
  });

  it("should throw when NEXT_PUBLIC_APP_URL is not a valid URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => getClientEnv()).toThrow("Invalid client environment variables");
  });
});

describe("checkEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should throw when POSTGRES_URL is not set", () => {
    delete process.env.POSTGRES_URL;
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    expect(() => checkEnv()).toThrow("POSTGRES_URL is required");
  });

  it("should throw when BETTER_AUTH_SECRET is not set", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => checkEnv()).toThrow("BETTER_AUTH_SECRET is required");
  });

  it("should not throw when required vars are set", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    expect(() => checkEnv()).not.toThrow();
  });

  it("should log warnings for missing optional vars in development", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    (process.env as Record<string, string>).NODE_ENV = "development";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.STRIPE_SECRET_KEY;

    checkEnv();

    expect(console.warn).toHaveBeenCalled();
  });

  it("should not log warnings in production even if optional vars are missing", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.GOOGLE_CLIENT_ID;

    checkEnv();

    // In production, console.warn is not called for env warnings
    // (Only development mode logs these warnings)
    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const envWarningCalls = warnCalls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("Environment warnings")
    );
    expect(envWarningCalls.length).toBe(0);
  });

  it("should not log warnings when all optional vars are set in development", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    process.env.STRIPE_SECRET_KEY = "stripe-key";

    checkEnv();

    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const envWarningCalls = warnCalls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("Environment warnings")
    );
    expect(envWarningCalls.length).toBe(0);
  });

  it("should warn about Google OAuth when only GOOGLE_CLIENT_ID is set", () => {
    process.env.POSTGRES_URL = "postgresql://localhost:5432/test";
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.GOOGLE_CLIENT_ID = "google-id";
    delete process.env.GOOGLE_CLIENT_SECRET;
    // Set other optional vars to isolate the Google OAuth warning
    process.env.OPENROUTER_API_KEY = "openrouter-key";
    process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
    process.env.STRIPE_SECRET_KEY = "stripe-key";

    checkEnv();

    const warnCalls = (console.warn as ReturnType<typeof vi.fn>).mock.calls;
    const googleWarningCalls = warnCalls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("Google OAuth")
    );
    expect(googleWarningCalls.length).toBeGreaterThan(0);
  });
});
