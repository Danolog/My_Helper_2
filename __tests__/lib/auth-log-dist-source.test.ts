// @vitest-environment node
/**
 * Reguły `ANONYMOUS_AUTH_LOG_RULES` (src/lib/auth-log.ts) dopasowują wpisy
 * Better Auth po stałym początku komunikatu. Gdy nowa wersja biblioteki zmieni
 * treść komunikatu, reguła przestaje działać po cichu i wpis wraca na swój
 * poziom z danymi z żądania w treści. Ten test czyta zainstalowane pliki dist
 * i wymaga, żeby każdy prefiks nadal występował w źródle wpisu.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANONYMOUS_AUTH_LOG_RULES } from "@/lib/auth-log";

/**
 * Katalog dist pakietu `better-auth` rozwiązany jak import z tego pliku
 * (eksport "." wskazuje plik w `dist/`), bez ścieżki bezwzględnej.
 */
const requireFromTest = createRequire(import.meta.url);
const betterAuthEntry = requireFromTest.resolve("better-auth");
const BETTER_AUTH_DIST = dirname(betterAuthEntry);

/**
 * `better-call` to zależność `better-auth`, nie aplikacji — rozwiązywany
 * z pliku better-auth, tak jak go ładuje sama biblioteka.
 */
const BETTER_CALL_DIST = dirname(createRequire(betterAuthEntry).resolve("better-call"));

const DIST_DIRS = { "better-auth": BETTER_AUTH_DIST, "better-call": BETTER_CALL_DIST } as const;

/**
 * Plik dist ze źródłem każdej reguły.
 * - `pkg` — pakiet (domyślnie `better-auth`);
 * - `call` — początek wywołania przed treścią (domyślnie `logger.error(`);
 *   po nim cudzysłów albo backtick i prefiks reguły;
 * - `label` — komunikat składany w bibliotece z szablonu
 *   `Invalid ${label}: ${url}` i wołany przez `validateURL(<wartość>, "<label>")`.
 */
interface DistSource {
  file: string;
  pkg?: keyof typeof DIST_DIRS;
  call?: string;
  label?: string;
}

/**
 * Błędy 415 better-call nie są wywołaniami loggera: to treść APIError
 * (`message: \`Content-Type …`), którą handler błędów better-auth
 * (api/index.mjs, `onError`) zapisuje jako `error`, gdy zawiera m.in. „table”.
 * Dlatego dla nich sprawdzany jest początek pola `message:`.
 */
const API_ERROR_MESSAGE = "message: ";

const RULE_SOURCES: Record<string, DistSource> = {
  "Provider not found. Make sure to add the provider in your auth config": { file: "api/routes/sign-in.mjs" },
  "Provider does not support id token verification": { file: "api/routes/sign-in.mjs" },
  INVALID_CALLBACK_REQUEST: { file: "api/routes/callback.mjs" },
  "State not found": { file: "api/routes/callback.mjs" },
  "Failed to parse state": { file: "oauth2/state.mjs" },
  "Invalid origin: ": { file: "api/middlewares/origin-check.mjs" },
  "Invalid callbackURL: ": { file: "api/middlewares/origin-check.mjs", label: "callbackURL" },
  "Invalid redirectURL: ": { file: "api/middlewares/origin-check.mjs", label: "redirectURL" },
  "Invalid errorCallbackURL: ": { file: "api/middlewares/origin-check.mjs", label: "errorCallbackURL" },
  "Invalid newUserCallbackURL: ": { file: "api/middlewares/origin-check.mjs", label: "newUserCallbackURL" },
  "Blocked cross-site navigation login attempt": { file: "api/middlewares/origin-check.mjs" },
  'Content-Type "': { pkg: "better-call", file: "utils.mjs", call: API_ERROR_MESSAGE },
  "Content-Type is required": { pkg: "better-call", file: "utils.mjs", call: API_ERROR_MESSAGE },
  "Sign-up attempt for existing email": { file: "api/routes/sign-up.mjs", call: "logger.info(" },
  "If it's a valid URL, please add ": { file: "api/middlewares/origin-check.mjs", call: "logger.info(" },
};

/** Dosłowny szablon z dist (to nie jest interpolacja w tym teście). */
const LABEL_TEMPLATE_CALL = "logger.error(`Invalid ${label}: ";

function readDist(source: DistSource): string {
  return readFileSync(join(DIST_DIRS[source.pkg ?? "better-auth"], source.file), "utf8");
}

describe("ANONYMOUS_AUTH_LOG_RULES a dist better-auth i better-call", () => {
  it("każda reguła ma wskazany plik źródłowy (nowa reguła wymaga wpisu)", () => {
    expect(Object.keys(RULE_SOURCES).sort()).toEqual(ANONYMOUS_AUTH_LOG_RULES.map((r) => r.prefix).sort());
  });

  it.each(ANONYMOUS_AUTH_LOG_RULES.map((rule) => rule.prefix))("%j występuje w źródle wpisu w dist", (prefix) => {
    const source = RULE_SOURCES[prefix];
    expect(source, `brak pliku źródłowego dla reguły ${prefix}`).toBeDefined();
    const code = readDist(source!);

    if (source!.label) {
      expect(code).toContain(LABEL_TEMPLATE_CALL);
      expect(code).toContain(`, "${source!.label}")`);
      expect(prefix).toBe(`Invalid ${source!.label}: `);
      return;
    }

    const call = source!.call ?? "logger.error(";
    const called = code.includes(`${call}"${prefix}`) || code.includes(`${call}\`${prefix}`);
    expect(called, `${call} z ${prefix} w ${source!.file}`).toBe(true);
  });
});
