// @vitest-environment node
/**
 * Produkcyjne auth.ts kieruje wpisy Better Auth do naszego loggera
 * (src/lib/auth-log.ts). Anonimowe `/sign-in/social` z niezarejestrowanym
 * dostawcą daje wpis `warn` w naszym loggerze, a nie tekstowy
 * `console.error` biblioteki (który Cloud Run mógłby uznać za ERROR).
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
});
