// @vitest-environment node
/**
 * Podłączenie limitu prób logowania w produkcyjnym `src/lib/auth.ts`.
 *
 * Moduł auth ładowany osobno dla każdego trybu `AUTH_RATE_LIMIT_STORE`
 * (`vi.resetModules()` + dynamiczny import). Fabryka opcji jest prawdziwa,
 * tylko owinięta szpiegiem — test sprawdza, że do instancji Better Auth trafiają
 * dokładnie te obiekty, które fabryka zwróciła. Wyjście systemowe liczników
 * i pule bazy to atrapy: konfiguracja nie dotyka bazy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { consumeAuthRateLimit, buildSpy } = vi.hoisted(() => ({
  consumeAuthRateLimit: vi.fn(),
  buildSpy: vi.fn(),
}));

vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/server/system/auth-throttle", () => ({
  consumeAuthRateLimit,
  reserveAccountSignInAttempt: vi.fn(),
  clearSignInFailures: vi.fn(),
}));
vi.mock("@/lib/auth-rate-limit-options", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-rate-limit-options")>();
  buildSpy.mockImplementation(actual.buildAuthRateLimitOptions);
  return { ...actual, buildAuthRateLimitOptions: buildSpy };
});

const SECRET = "test-secret-for-auth-throttle-0123456789abcdef";

type AuthOptions = {
  rateLimit?: { enabled?: boolean; customStorage?: { consume?: unknown } };
  hooks?: unknown;
  emailAndPassword?: Record<string, unknown>;
};

async function loadAuth() {
  vi.resetModules();
  const { auth } = await import("@/lib/auth");
  return { options: auth.options as AuthOptions, spy: buildSpy };
}

beforeEach(() => {
  buildSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tryb database", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_RATE_LIMIT_STORE", "database");
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  });

  it("fabryka wywołana z trybem database", async () => {
    const { spy } = await loadAuth();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("database");
  });

  it("rateLimit, hooks i onPasswordReset w instancji to dokładnie obiekty zwrócone przez fabrykę", async () => {
    const { options, spy } = await loadAuth();
    const built = spy.mock.results[0]?.value as {
      rateLimit: unknown;
      hooks: unknown;
      onPasswordReset: unknown;
    };
    expect(built.rateLimit).toBeDefined();
    expect(built.hooks).toBeDefined();
    expect(built.onPasswordReset).toBeTypeOf("function");
    expect(options.rateLimit).toBe(built.rateLimit);
    expect(options.hooks).toBe(built.hooks);
    expect(options.emailAndPassword?.onPasswordReset).toBe(built.onPasswordReset);
  });

  it("limit włączony, licznik adresu = wyjście systemowe", async () => {
    const { options } = await loadAuth();
    expect(options.rateLimit?.enabled).toBe(true);
    expect(options.rateLimit?.customStorage?.consume).toBe(consumeAuthRateLimit);
  });

  it("bez BETTER_AUTH_SECRET → import modułu auth odrzucony", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    await expect(loadAuth()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe.each([
  ["brak zmiennej", undefined],
  ["memory", "memory"],
])("tryb domyślny (%s)", (_name, value) => {
  beforeEach(() => {
    vi.stubEnv("AUTH_RATE_LIMIT_STORE", value);
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  });

  it("fabryka wywołana z trybem memory", async () => {
    const { spy } = await loadAuth();
    expect(spy).toHaveBeenCalledWith("memory");
  });

  it("instancja bez własnych rateLimit i hooks, emailAndPassword bez onPasswordReset", async () => {
    const { options } = await loadAuth();
    expect(Object.hasOwn(options, "rateLimit")).toBe(false);
    expect(Object.hasOwn(options, "hooks")).toBe(false);
    expect(options.emailAndPassword).toBeDefined();
    expect(Object.hasOwn(options.emailAndPassword!, "onPasswordReset")).toBe(false);
  });
});

describe("niedozwolona wartość", () => {
  it.each([["Database"], [""], ["redis"]])("wartość %j → import modułu auth odrzucony", async (value) => {
    vi.stubEnv("AUTH_RATE_LIMIT_STORE", value);
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
    await expect(loadAuth()).rejects.toThrow(/AUTH_RATE_LIMIT_STORE/);
  });
});
