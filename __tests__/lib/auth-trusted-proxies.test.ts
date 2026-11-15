/**
 * Konfiguracja Better Auth: advanced.ipAddress.trustedProxies czyta TO SAMO
 * źródło co getClientIp (TRUSTED_PROXIES przez getTrustedProxies), a
 * advanced.trustedProxyHeaders zostaje wyłączone (przegląd Ryana #17, b2).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => ({ options }),
}));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => false,
  sendPasswordResetEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));

type AdvancedOptions = {
  advanced?: {
    trustedProxyHeaders?: boolean;
    ipAddress?: { trustedProxies?: string[]; ipAddressHeaders?: string[] };
  };
};

async function loadAuthOptions(): Promise<AdvancedOptions> {
  vi.resetModules();
  const mod = await import("@/lib/auth");
  return (mod.auth as unknown as { options: AdvancedOptions }).options;
}

const original = process.env.TRUSTED_PROXIES;

afterEach(() => {
  if (original === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = original;
});

describe("auth: advanced.ipAddress.trustedProxies", () => {
  it("brak TRUSTED_PROXIES: trustedProxies nieustawione (zachowanie jak dziś)", async () => {
    delete process.env.TRUSTED_PROXIES;
    const options = await loadAuthOptions();
    expect(options.advanced?.ipAddress?.trustedProxies).toBeUndefined();
    expect(options.advanced?.ipAddress?.ipAddressHeaders).toBeUndefined();
  });

  it("TRUSTED_PROXIES ustawione: ta sama przefiltrowana lista (bez szerokich zakresów)", async () => {
    process.env.TRUSTED_PROXIES = "34.120.10.5, 35.191.0.0/16, 10.0.0.0/8, 0.0.0.0/0";
    const options = await loadAuthOptions();
    expect(options.advanced?.ipAddress?.trustedProxies).toEqual(["34.120.10.5", "35.191.0.0/16"]);
  });

  it("advanced.trustedProxyHeaders pozostaje wyłączone", async () => {
    process.env.TRUSTED_PROXIES = "34.120.10.5";
    const options = await loadAuthOptions();
    expect(options.advanced?.trustedProxyHeaders).not.toBe(true);
  });
});
