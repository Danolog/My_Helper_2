// @vitest-environment node
/**
 * Zamknięte listy ścieżek licznika adresu (`src/lib/auth-rate-limit-paths.ts`):
 * - ścieżki liczone w pamięci procesu (każda inna idzie do licznika w bazie;
 *   podział sprawdza `__tests__/lib/auth-throttle.test.ts`);
 * - trasy biblioteki w kluczu licznika: ścieżka w kluczu i w logu jako szablon trasy,
 *   ścieżki spoza listy liczone wspólnie na adres.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import {
  COUNTER_KEY_PATHS,
  MEMORY_COUNTED_PATHS,
  OTHER_PATHS_KEY,
  counterKeyPathOf,
  isMemoryCountedPath,
} from "@/lib/auth-rate-limit-paths";

const LIBRARY_ROUTES = [
  "/account-info",
  "/callback/:id",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/error",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-in/social",
  "/sign-out",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

describe("trasy biblioteki w kluczu licznika adresu", () => {
  it("lista tras: dokładnie trasy HTTP Better Auth w tej konfiguracji", () => {
    expect(COUNTER_KEY_PATHS).toEqual(LIBRARY_ROUTES);
  });

  it("lista jest zamrożona", () => {
    expect(Object.isFrozen(COUNTER_KEY_PATHS)).toBe(true);
  });

  it("lista = trasy HTTP prawdziwej instancji Better Auth (e-mail i hasło, weryfikacja, Google)", () => {
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "test-secret-for-auth-rate-limit-paths-0123456789",
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true, sendResetPassword: async () => {} },
      emailVerification: { sendVerificationEmail: async () => {} },
      socialProviders: { google: { clientId: "it-client-id", clientSecret: "it-client-secret" } },
    });
    const routes = Object.values(auth.api as Record<string, { path?: unknown }>)
      .map((ep) => ep.path)
      .filter((p): p is string => typeof p === "string");
    expect([...new Set(routes)].sort()).toEqual([...COUNTER_KEY_PATHS].sort());
  });

  it.each(LIBRARY_ROUTES.filter((p) => !p.includes(":")))("%s → ta sama ścieżka", (p) => {
    expect(counterKeyPathOf(p)).toBe(p);
  });

  it.each([
    ["/reset-password/Tk7resetTk7resetTk7reset", "/reset-password/:token"],
    ["/reset-password/:token", "/reset-password/:token"],
    ["/callback/google", "/callback/:id"],
  ])("%s → szablon trasy %s", (p, expected) => {
    expect(counterKeyPathOf(p)).toBe(expected);
  });

  it.each([
    ["/sciezka-nieznana-bibliotece"],
    ["/reset-password/"],
    ["/reset-password/a/b"],
    ["/callback/"],
    ["/callback"],
    ["/delete-user/callback/x"],
    ["/SIGN-IN/EMAIL"],
    ["/sign-in/email/"],
    ["/sign-in/email|/get-session"],
    ["sign-in/email"],
    ["/"],
    [""],
  ])("%j → wspólny klucz ścieżek spoza listy", (p) => {
    expect(counterKeyPathOf(p)).toBe(OTHER_PATHS_KEY);
  });

  it("wspólny klucz nie jest ścieżką z listy", () => {
    expect(OTHER_PATHS_KEY).toBe("other");
    expect(COUNTER_KEY_PATHS).not.toContain(OTHER_PATHS_KEY);
  });
});

describe("lista ścieżek liczonych w pamięci procesu", () => {
  it("dokładnie pięć pozycji: get-session, sign-out, list-sessions, callback/*, ok", () => {
    expect(MEMORY_COUNTED_PATHS).toEqual(["/get-session", "/sign-out", "/list-sessions", "/callback/*", "/ok"]);
  });

  it("lista jest zamrożona", () => {
    expect(Object.isFrozen(MEMORY_COUNTED_PATHS)).toBe(true);
  });

  it.each([["/get-session"], ["/sign-out"], ["/list-sessions"], ["/callback/google"], ["/ok"]])("%s → pamięć", (p) => {
    expect(isMemoryCountedPath(p)).toBe(true);
  });

  it.each([
    ["/sign-in/email"],
    ["/sign-up/email"],
    ["/verify-email"],
    ["/reset-password"],
    ["/callback"],
    ["/callback/"],
    ["/get-session-x"],
    ["/get-session/x"],
    ["/oki"],
    ["/ok/x"],
    [""],
    ["/"],
  ])("%j → nie pamięć", (p) => {
    expect(isMemoryCountedPath(p)).toBe(false);
  });
});
