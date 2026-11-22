// @vitest-environment node
/**
 * Produkcyjne auth.ts kieruje wpisy Better Auth do naszego loggera
 * (src/lib/auth-log.ts). Anonimowe `/sign-in/social` z niezarejestrowanym
 * dostawcą daje wpis `warn` w naszym loggerze, a nie tekstowy
 * `console.error` biblioteki (który Cloud Run mógłby uznać za ERROR).
 * Tak samo odrzucenie żądania z obcym `Origin` albo niedozwolonym
 * `Content-Type` przez `auth.handler`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Konfiguracja nie może dotknąć bazy: pula systemowa i surowe db to atrapy.
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));

describe("auth.ts: logger Better Auth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signInSocial z niezarejestrowanym dostawcą → warn w naszym loggerze, bez console.error biblioteki", async () => {
    vi.resetModules();
    const { auth } = await import("@/lib/auth");
    const { logger } = await import("@/lib/logger");
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // github nie jest nigdy rejestrowany w auth.ts (tylko google, warunkowo).
    await expect(
      auth.api.signInSocial({ body: { provider: "github", callbackURL: "/" } }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(warn).toHaveBeenCalledWith("Provider not found", { provider: "github" });
    expect(error).not.toHaveBeenCalled();
    const libraryConsoleErrors = consoleError.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[Better Auth]")),
    );
    expect(libraryConsoleErrors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  /**
   * W testach Better Auth domyślnie pomija sprawdzenie origin (`isTest()` →
   * `skipOriginCheck`), więc instancja z auth.ts nie dojdzie do wpisu
   * „Invalid origin”. Prawdziwy `betterAuth` z tą samą opcją `logger` i jawnie
   * włączonym sprawdzeniem; bez bazy (adapter pamięciowy), bo origin jest
   * sprawdzany przed endpointem.
   */
  it("POST z ciasteczkiem i obcym Origin → 403 i warn w naszym loggerze, bez console.error", async () => {
    vi.resetModules();
    const { betterAuth } = await import("better-auth");
    const { betterAuthLoggerOptions } = await import("@/lib/auth-log");
    const { logger } = await import("@/lib/logger");

    const baseURL = "http://localhost:3000";
    const auth = betterAuth({
      baseURL,
      logger: betterAuthLoggerOptions,
      trustedOrigins: [baseURL],
      advanced: { disableOriginCheck: false },
    });
    // Wpisy z inicjalizacji kontekstu nie mieszają się z wpisem żądania.
    await auth.$context;

    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "theme=light",
          origin: "https://evil.example.com",
        },
        body: JSON.stringify({ provider: "github", callbackURL: "/" }),
      }),
    );

    // 403 (INVALID_ORIGIN), a nie 404 nieznanego dostawcy: odrzucenie przed endpointem.
    expect(response.status).toBe(403);
    expect(warn).toHaveBeenCalledWith("Invalid origin", { origin: "https://evil.example.com" });
    expect(error).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  /**
   * better-call odrzuca ciało z typem spoza `application/json` (415), a treść
   * błędu zawiera wartość nagłówka. Handler błędów better-auth zapisuje ją
   * jako `error`, gdy zawiera m.in. „table” — wywoła to każdy anonimowy klient.
   */
  it("POST z Content-Type text/table → 415 i warn w naszym loggerze, bez error i console.error", async () => {
    vi.resetModules();
    const { betterAuth } = await import("better-auth");
    const { betterAuthLoggerOptions } = await import("@/lib/auth-log");
    const { logger } = await import("@/lib/logger");

    const baseURL = "http://localhost:3000";
    const auth = betterAuth({ baseURL, logger: betterAuthLoggerOptions, trustedOrigins: [baseURL] });
    await auth.$context;

    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "text/table" },
        body: "provider=github",
      }),
    );

    expect(response.status).toBe(415);
    expect(warn).toHaveBeenCalledWith("Content-Type is not allowed", undefined);
    expect(error).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
