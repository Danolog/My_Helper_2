// @vitest-environment node
/**
 * Fabryka opcji limitu prób logowania (`src/lib/auth-rate-limit-options.ts`).
 *
 * Konfiguracja sprawdzana na prawdziwej instancji Better Auth (adapter pamięciowy
 * biblioteki dla użytkowników, `auth.handler(new Request(...))`); wyjście systemowe
 * liczników zastąpione atrapą — liczenie w bazie sprawdzają testy pg. Tu: które
 * żądania rezerwują próbę na konto, które zerują licznik, jak wygląda odmowa
 * i że flaga `enabled` w trybie `database` nie zależy od NODE_ENV.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reserveAccountSignInAttempt, clearSignInFailures, consumeAuthRateLimit } = vi.hoisted(() => ({
  reserveAccountSignInAttempt: vi.fn(),
  clearSignInFailures: vi.fn(),
  consumeAuthRateLimit: vi.fn(),
}));
vi.mock("@/lib/server/system/auth-throttle", () => ({
  reserveAccountSignInAttempt,
  clearSignInFailures,
  consumeAuthRateLimit,
}));

import { buildAuthRateLimitOptions } from "@/lib/auth-rate-limit-options";

const SECRET = "test-secret-for-auth-throttle-0123456789abcdef";
const BASE = "http://localhost:3000";
const PASSWORD = "Poprawne-Haslo-123";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  reserveAccountSignInAttempt.mockReset().mockResolvedValue({ allowed: true, retryAfter: null });
  clearSignInFailures.mockReset().mockResolvedValue({ cleared: true });
  consumeAuthRateLimit.mockReset().mockResolvedValue({ allowed: true, retryAfter: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("tryb memory", () => {
  it("pusty fragment: bez rateLimit (także bez flagi enabled), bez hooków, bez onPasswordReset", () => {
    const opts = buildAuthRateLimitOptions("memory");
    expect(opts).toEqual({});
    expect("rateLimit" in opts).toBe(false);
    expect("hooks" in opts).toBe(false);
    expect("onPasswordReset" in opts).toBe(false);
  });

  it("nie wymaga sekretu", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => buildAuthRateLimitOptions("memory")).not.toThrow();
  });
});

describe("tryb database: konfiguracja", () => {
  it.each([["development"], ["test"], ["production"]])("rateLimit.enabled === true przy NODE_ENV=%s", (env) => {
    vi.stubEnv("NODE_ENV", env);
    const opts = buildAuthRateLimitOptions("database");
    expect("rateLimit" in opts && opts.rateLimit.enabled).toBe(true);
  });

  it("customStorage.consume to licznik adresu z wyjścia systemowego", () => {
    const opts = buildAuthRateLimitOptions("database");
    expect("rateLimit" in opts && opts.rateLimit.customStorage.consume).toBe(consumeAuthRateLimit);
  });

  it.each([[undefined], [""]])("brak sekretu (%j) → błąd przy budowie opcji", (value) => {
    if (value === undefined) delete process.env.BETTER_AUTH_SECRET;
    else vi.stubEnv("BETTER_AUTH_SECRET", value);
    expect(() => buildAuthRateLimitOptions("database")).toThrow(/BETTER_AUTH_SECRET/);
  });
});

// ── Instancja Better Auth z fabryką ──────────────────────────────────────────

type Captured = { resetToken?: string };

function makeAuth(opts: { requireEmailVerification?: boolean; enabledOverride?: boolean } = {}) {
  const rl = buildAuthRateLimitOptions("database");
  if (!("rateLimit" in rl)) throw new Error("tryb database bez rateLimit");
  const captured: Captured = {};
  const auth = betterAuth({
    baseURL: BASE,
    secret: SECRET,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    trustedOrigins: [BASE],
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    rateLimit: opts.enabledOverride === undefined ? rl.rateLimit : { ...rl.rateLimit, enabled: opts.enabledOverride },
    hooks: rl.hooks,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification ?? false,
      sendResetPassword: async ({ token }) => {
        captured.resetToken = token;
      },
      onPasswordReset: rl.onPasswordReset,
    },
  });
  return { auth, captured };
}

const post = (path: string, body: unknown, ip = "198.51.100.1") =>
  new Request(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function signUp(auth: ReturnType<typeof makeAuth>["auth"], email: string) {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Test" } });
  reserveAccountSignInAttempt.mockClear();
  clearSignInFailures.mockClear();
}

describe("tryb database: rezerwacja próby na konto (hooks.before)", () => {
  it("każde logowanie e-mailem rezerwuje próbę przed sprawdzeniem hasła, z adresem z żądania", async () => {
    const { auth } = makeAuth();
    const res = await auth.handler(post("/sign-in/email", { email: "Nie.Ma@Example.PL", password: "zle-haslo-123" }));
    expect(res.status).toBe(401);
    expect(reserveAccountSignInAttempt).toHaveBeenCalledTimes(1);
    expect(reserveAccountSignInAttempt).toHaveBeenCalledWith("Nie.Ma@Example.PL");
  });

  it("inne ścieżki nie rezerwują", async () => {
    const { auth } = makeAuth();
    await auth.handler(post("/sign-up/email", { email: "nowy@example.pl", password: PASSWORD, name: "N" }));
    await auth.handler(post("/request-password-reset", { email: "nowy@example.pl" }));
    await auth.handler(new Request(`${BASE}/api/auth/get-session`, { headers: { "x-forwarded-for": "198.51.100.1" } }));
    expect(reserveAccountSignInAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ["bez pola email", { password: "x" }],
    ["email pusty", { email: "", password: "x" }],
    ["email z samych spacji", { email: "   ", password: "x" }],
    ["email nie-napis", { email: 42, password: "x" }],
  ])("%s → bez rezerwacji, bez wyjątku, odpowiedź biblioteki", async (_label, body) => {
    const { auth } = makeAuth();
    const res = await auth.handler(post("/sign-in/email", body));
    expect(res.status).toBe(400);
    expect(reserveAccountSignInAttempt).not.toHaveBeenCalled();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it("odmowa rezerwacji → 429 identyczne z odpowiedzią limitu biblioteki; hasło nie jest sprawdzane", async () => {
    const { auth } = makeAuth();
    await signUp(auth, "jan@example.pl");

    consumeAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 42 });
    const lib = await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: PASSWORD }, "198.51.100.2"));

    reserveAccountSignInAttempt.mockResolvedValueOnce({ allowed: false, retryAfter: 42 });
    const ours = await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: PASSWORD }, "198.51.100.3"));

    expect(ours.status).toBe(429);
    expect(ours.status).toBe(lib.status);
    expect(ours.statusText).toBe(lib.statusText);
    expect([...ours.headers.entries()].sort()).toEqual([...lib.headers.entries()].sort());
    expect(await ours.text()).toBe(await lib.text());
    // Poprawne hasło przy odmowie nie loguje i nie zeruje licznika.
    expect(ours.headers.get("set-cookie")).toBeNull();
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it("429 limitu adresu nie rezerwuje próby na konto", async () => {
    const { auth } = makeAuth();
    consumeAuthRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 5 });
    const res = await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: "zle-haslo-123" }));
    expect(res.status).toBe(429);
    expect(reserveAccountSignInAttempt).not.toHaveBeenCalled();
  });

  it("hooki na konto działają niezależnie od flagi enabled", async () => {
    const { auth } = makeAuth({ enabledOverride: false });
    await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: "zle-haslo-123" }));
    expect(consumeAuthRateLimit).not.toHaveBeenCalled();
    expect(reserveAccountSignInAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("tryb database: zerowanie licznika konta (hooks.after, onPasswordReset)", () => {
  it("udane logowanie (2xx) → zerowanie", async () => {
    const { auth } = makeAuth();
    await signUp(auth, "jan@example.pl");
    const res = await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(clearSignInFailures).toHaveBeenCalledTimes(1);
    expect(clearSignInFailures).toHaveBeenCalledWith("jan@example.pl");
  });

  it("złe hasło (401) → bez zerowania", async () => {
    const { auth } = makeAuth();
    await signUp(auth, "jan@example.pl");
    const res = await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: "zle-haslo-123" }));
    expect(res.status).toBe(401);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it("nieistniejące konto (401) → bez zerowania", async () => {
    const { auth } = makeAuth();
    const res = await auth.handler(post("/sign-in/email", { email: "nie-ma@example.pl", password: PASSWORD }));
    expect(res.status).toBe(401);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it("400 z rezerwacją (zły format adresu) → bez zerowania", async () => {
    const { auth } = makeAuth();
    const res = await auth.handler(post("/sign-in/email", { email: "to-nie-adres", password: PASSWORD }));
    expect(res.status).toBe(400);
    expect(reserveAccountSignInAttempt).toHaveBeenCalledTimes(1);
    expect(clearSignInFailures).not.toHaveBeenCalled();
  });

  it("kolejność na tej wersji biblioteki: niezweryfikowane konto — złe hasło 401 bez zerowania, dobre hasło 403 EMAIL_NOT_VERIFIED z zerowaniem", async () => {
    const { auth } = makeAuth({ requireEmailVerification: true });
    await signUp(auth, "nowa@example.pl");

    const bad = await auth.handler(post("/sign-in/email", { email: "nowa@example.pl", password: "zle-haslo-123" }));
    expect(bad.status).toBe(401);
    expect(clearSignInFailures).not.toHaveBeenCalled();

    const good = await auth.handler(post("/sign-in/email", { email: "nowa@example.pl", password: PASSWORD }));
    expect(good.status).toBe(403);
    expect(((await good.json()) as { code?: string }).code).toBe("EMAIL_NOT_VERIFIED");
    expect(clearSignInFailures).toHaveBeenCalledTimes(1);
    expect(clearSignInFailures).toHaveBeenCalledWith("nowa@example.pl");
  });

  it("udany reset hasła → zerowanie licznika konta", async () => {
    const { auth, captured } = makeAuth();
    await signUp(auth, "jan@example.pl");
    await auth.handler(post("/request-password-reset", { email: "jan@example.pl", redirectTo: `${BASE}/reset-password` }));
    expect(captured.resetToken).toBeDefined();
    clearSignInFailures.mockClear();
    const res = await auth.handler(post("/reset-password", { token: captured.resetToken, newPassword: "Nowe-Haslo-456" }));
    expect(res.status).toBe(200);
    expect(clearSignInFailures).toHaveBeenCalledWith("jan@example.pl");
  });

  it("błąd zerowania nie psuje udanego logowania", async () => {
    const { auth } = makeAuth();
    await signUp(auth, "jan@example.pl");
    clearSignInFailures.mockResolvedValueOnce({ cleared: false });
    const res = await auth.handler(post("/sign-in/email", { email: "jan@example.pl", password: PASSWORD }));
    expect(res.status).toBe(200);
  });
});
