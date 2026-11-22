// @vitest-environment node
/**
 * Reguły `ANONYMOUS_AUTH_LOG_RULES` (src/lib/auth-log.ts) dopasowują wpisy
 * Better Auth po stałym początku komunikatu. Gdy nowa wersja biblioteki zmieni
 * treść `logger.error(...)`, reguła przestaje działać po cichu i wpis wraca
 * na poziom `error`. Ten test czyta zainstalowane pliki dist biblioteki i
 * wymaga, żeby każdy prefiks nadal występował w wywołaniu `logger.error(`.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANONYMOUS_AUTH_LOG_RULES } from "@/lib/auth-log";

/**
 * Katalog dist pakietu `better-auth` rozwiązany jak import z tego pliku
 * (eksport "." wskazuje `dist/index.mjs`), bez ścieżki bezwzględnej.
 */
const requireFromTest = createRequire(import.meta.url);
const BETTER_AUTH_DIST = dirname(requireFromTest.resolve("better-auth"));

/**
 * Plik dist z wywołaniem dla każdej reguły. `label` — komunikat składany
 * w bibliotece z szablonu `Invalid ${label}: ${url}` i wołany przez
 * `validateURL(<wartość>, "<label>")`.
 */
interface DistSource {
  file: string;
  label?: string;
}

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
};

/** Dosłowny szablon z dist (to nie jest interpolacja w tym teście). */
const LABEL_TEMPLATE_CALL = "logger.error(`Invalid ${label}: ";

function readDist(file: string): string {
  return readFileSync(join(BETTER_AUTH_DIST, file), "utf8");
}

describe("ANONYMOUS_AUTH_LOG_RULES a dist better-auth", () => {
  it("każda reguła ma wskazany plik źródłowy (nowa reguła wymaga wpisu)", () => {
    expect(Object.keys(RULE_SOURCES).sort()).toEqual(ANONYMOUS_AUTH_LOG_RULES.map((r) => r.prefix).sort());
  });

  it.each(ANONYMOUS_AUTH_LOG_RULES.map((rule) => rule.prefix))(
    "%j występuje w wywołaniu logger.error( w dist",
    (prefix) => {
      const source = RULE_SOURCES[prefix];
      expect(source, `brak pliku źródłowego dla reguły ${prefix}`).toBeDefined();
      const code = readDist(source!.file);

      if (source!.label) {
        expect(code).toContain(LABEL_TEMPLATE_CALL);
        expect(code).toContain(`, "${source!.label}")`);
        expect(prefix).toBe(`Invalid ${source!.label}: `);
        return;
      }

      const called = code.includes(`logger.error("${prefix}`) || code.includes(`logger.error(\`${prefix}`);
      expect(called, `logger.error( z ${prefix} w ${source!.file}`).toBe(true);
    },
  );
});
