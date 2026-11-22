// @vitest-environment node
/**
 * Mapowanie wpisów Better Auth na nasz logger (src/lib/auth-log.ts):
 * znane komunikaty wywoływalne anonimowo → warn z bezpiecznym kontekstem,
 * reszta na swoim poziomie przez redakcję loggera.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_AUTH_LOG_RULES,
  AUTH_LOG_ORIGIN_MAX_LENGTH,
  AUTH_LOG_UNPARSEABLE,
  betterAuthLoggerOptions,
  mapBetterAuthLog,
  safeOriginForLog,
} from "@/lib/auth-log";
import { REDACTED } from "@/lib/logger";
import { INVALID_JSON_MESSAGE } from "@/lib/safe-error";

/** Komunikaty i argumenty w postaci, w jakiej woła je better-auth 1.7.25 (dist). */
const KNOWN_ANONYMOUS_ERRORS: { message: string; args: unknown[]; expected: { message: string; context?: unknown } }[] = [
  {
    message: "Provider not found. Make sure to add the provider in your auth config",
    args: [{ provider: "github" }],
    expected: { message: "Provider not found", context: { provider: "github" } },
  },
  {
    message: "Provider does not support id token verification",
    args: [{ provider: "discord" }],
    expected: { message: "Provider does not support id token verification", context: { provider: "discord" } },
  },
  {
    message: "INVALID_CALLBACK_REQUEST",
    args: [new Error("Invalid input: jan.kowalski@example.com")],
    expected: { message: "INVALID_CALLBACK_REQUEST" },
  },
  {
    message: "State not found",
    args: ["access_denied jan.kowalski@example.com"],
    expected: { message: "State not found" },
  },
  {
    message: "Failed to parse state",
    args: [Object.assign(new Error("State mismatch: verification not found"), { code: "state_mismatch" })],
    expected: { message: "Failed to parse state", context: { stateErrorCode: "state_mismatch" } },
  },
  {
    message: "Invalid origin: https://evil.example.com",
    args: [],
    expected: { message: "Invalid origin", context: { origin: "https://evil.example.com" } },
  },
  {
    message: "Invalid callbackURL: https://evil.example.com/path?token=abc",
    args: [],
    expected: { message: "Invalid callbackURL", context: { origin: "https://evil.example.com" } },
  },
  {
    message: "Invalid redirectURL: https://evil.example.com/r",
    args: [],
    expected: { message: "Invalid redirectURL", context: { origin: "https://evil.example.com" } },
  },
  {
    message: "Invalid errorCallbackURL: https://evil.example.com/e",
    args: [],
    expected: { message: "Invalid errorCallbackURL", context: { origin: "https://evil.example.com" } },
  },
  {
    message: "Invalid newUserCallbackURL: https://evil.example.com/n",
    args: [],
    expected: { message: "Invalid newUserCallbackURL", context: { origin: "https://evil.example.com" } },
  },
  {
    message: "Blocked cross-site navigation login attempt (CSRF protection)",
    args: [{ secFetchSite: "cross-site", secFetchMode: "navigate", secFetchDest: "document" }],
    expected: { message: "Blocked cross-site navigation login attempt (CSRF protection)" },
  },
];

describe("mapBetterAuthLog: znane komunikaty anonimowe", () => {
  it.each(KNOWN_ANONYMOUS_ERRORS)("$message → warn, stały tekst, bezpieczny kontekst", ({ message, args, expected }) => {
    expect(mapBetterAuthLog("error", message, args)).toEqual({ level: "warn", ...expected });
  });

  it("lista reguł = lista przypadków testu (nowa reguła wymaga przypadku)", () => {
    const covered = ANONYMOUS_AUTH_LOG_RULES.filter((rule) =>
      KNOWN_ANONYMOUS_ERRORS.some((c) => c.message.startsWith(rule.prefix)),
    );
    expect(covered).toHaveLength(ANONYMOUS_AUTH_LOG_RULES.length);
    expect(ANONYMOUS_AUTH_LOG_RULES.map((r) => r.prefix)).toEqual([
      "Provider not found. Make sure to add the provider in your auth config",
      "Provider does not support id token verification",
      "INVALID_CALLBACK_REQUEST",
      "State not found",
      "Failed to parse state",
      "Invalid origin: ",
      "Invalid callbackURL: ",
      "Invalid redirectURL: ",
      "Invalid errorCallbackURL: ",
      "Invalid newUserCallbackURL: ",
      "Blocked cross-site navigation login attempt",
    ]);
  });

  it("znany komunikat na poziomie warn/info nie jest przerabiany przez reguły", () => {
    expect(mapBetterAuthLog("warn", "State not found", [])).toEqual({ level: "warn", message: "State not found" });
  });

  it("identyfikator dostawcy z obcymi znakami → tylko znaki identyfikatora, ograniczona długość", () => {
    const mapped = mapBetterAuthLog("error", KNOWN_ANONYMOUS_ERRORS[0]!.message, [
      { provider: `git\nhub<script>${"x".repeat(200)}` },
    ]);
    const provider = (mapped.context as { provider: string }).provider;
    expect(provider).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(provider.length).toBeLessThanOrEqual(40);
  });

  it.each(["", "<>\n", " ./ "])(
    "identyfikator dostawcy pusty po oczyszczeniu (%j) → znacznik, nie pusty napis",
    (provider) => {
      const mapped = mapBetterAuthLog("error", KNOWN_ANONYMOUS_ERRORS[0]!.message, [{ provider }]);
      expect(mapped).toEqual({ level: "warn", message: "Provider not found", context: { provider: AUTH_LOG_UNPARSEABLE } });
    },
  );
});

describe("mapBetterAuthLog: pozostałe wpisy", () => {
  it("nieznany error zostaje error, argumenty w kontekście args", () => {
    const err = new Error("connection refused");
    expect(mapBetterAuthLog("error", "Failed to create session", [err])).toEqual({
      level: "error",
      message: "Failed to create session",
      context: { args: [err] },
    });
  });

  it("treść nieznanego wpisu z parametrami zapytania (e-mail) → zredagowana", () => {
    const mapped = mapBetterAuthLog(
      "error",
      "Failed query: select * from \"user\" where email = $1\nparams: jan.kowalski@example.com",
      [],
    );
    expect(mapped.level).toBe("error");
    expect(mapped.message).not.toContain("jan.kowalski@example.com");
    expect(mapped.message).toBe(`Failed query: select * from "user" where email = $1\nparams: ${REDACTED}`);
  });

  it("treść nieznanego wpisu z wycinkiem wejścia JSON (e-mail) → stała treść", () => {
    const mapped = mapBetterAuthLog("warn", `Unexpected token 'j', "jan.kowalski@example.com" is not valid JSON`, []);
    expect(mapped).toEqual({ level: "warn", message: INVALID_JSON_MESSAGE });
  });

  it("treść nieznanego wpisu bez danych do redakcji → bez zmian", () => {
    expect(mapBetterAuthLog("error", "Failed to create session", []).message).toBe("Failed to create session");
  });

  it("Failed to parse state z błędem innym niż StateError klienta → error", () => {
    const dbError = Object.assign(new Error("db down"), { code: "ECONNREFUSED" });
    expect(mapBetterAuthLog("error", "Failed to parse state", [dbError]).level).toBe("error");
    expect(mapBetterAuthLog("error", "Failed to parse state", [new Error("x")]).level).toBe("error");
  });

  it("info i debug zostają na swoim poziomie", () => {
    expect(mapBetterAuthLog("info", "If it's a valid URL, please add x", ["Current list"])).toEqual({
      level: "info",
      message: "If it's a valid URL, please add x",
      context: { args: ["Current list"] },
    });
    expect(mapBetterAuthLog("debug", "debug entry", [])).toEqual({ level: "debug", message: "debug entry" });
  });

  it("opcja dla betterAuth bez jawnego level (jawny włącza wpis error dla każdego błędu API)", () => {
    expect(Object.keys(betterAuthLoggerOptions)).toEqual(["log"]);
  });
});

describe("safeOriginForLog", () => {
  it("adres ze ścieżką, zapytaniem i danymi logowania → sam origin", () => {
    expect(safeOriginForLog("https://user:pw@evil.example.com:8443/a/b?c=d#e")).toBe("https://evil.example.com:8443");
  });

  it("nowe linie w wartości → brak nowych linii w wyniku", () => {
    const mapped = mapBetterAuthLog("error", "Invalid origin: https://evil.example.com\r\nFAKE ERROR entry", []);
    const origin = (mapped.context as { origin: string }).origin;
    expect(origin).not.toMatch(/[\r\n]/);
    expect(mapped.message).toBe("Invalid origin");
  });

  it("bardzo długi origin → obcięty", () => {
    const origin = safeOriginForLog(`https://${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.example.com`);
    expect(origin.length).toBe(AUTH_LOG_ORIGIN_MAX_LENGTH);
  });

  it("wartość niebędąca adresem http(s) → znacznik", () => {
    expect(safeOriginForLog("null")).toBe(AUTH_LOG_UNPARSEABLE);
    expect(safeOriginForLog("javascript:alert(1)")).toBe(AUTH_LOG_UNPARSEABLE);
    expect(safeOriginForLog("//evil.example.com")).toBe(AUTH_LOG_UNPARSEABLE);
    expect(safeOriginForLog(undefined)).toBe(AUTH_LOG_UNPARSEABLE);
  });
});

describe("betterAuthLoggerOptions.log: redakcja przez logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("argumenty z e-mailem i telefonem → zredagowane w kontekście wpisu", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    betterAuthLoggerOptions.log("error", "Some library failure", {
      email: "jan.kowalski@example.com",
      phone: "+48500600700",
      userId: "u1",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(consoleError.mock.calls[0]);
    expect(serialized).not.toContain("jan.kowalski@example.com");
    expect(serialized).not.toContain("+48500600700");
    expect(serialized).toContain(REDACTED);
    expect(serialized).toContain("u1");
  });

  it("znany komunikat → console.warn, bez danych z żądania", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    betterAuthLoggerOptions.log("error", "State not found", "access_denied jan.kowalski@example.com");

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleWarn.mock.calls[0])).not.toContain("jan.kowalski@example.com");
  });
});
