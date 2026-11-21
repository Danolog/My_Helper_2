/**
 * #193 P0a — reguły izolacji danych salonu (Z2, Z3, W1).
 *
 * Kod w `src/` nie importuje surowej puli `db` (`src/lib/db.ts`) ani puli
 * systemowej (`server/system/db-system`, poza `src/lib/server/system/**`).
 * Dane salonu idą przez `forSalon(salonId)` z `@/lib/server/repository`,
 * wyjścia systemowe przez nazwane funkcje z `@/lib/server/system/*`.
 *
 * Formy importu objęte regułą: statyczny (alias i względny), `import *`,
 * re-eksport (`export … from`), `import()` i `require()` z literałem.
 *
 * Wyjątki:
 * - DB_ISOLATION_PERMANENT — z definicji (warstwa repozytorium);
 * - DB_ISOLATION_TRANSITIONAL — dług: pliki, które dziś importują `db`.
 *   Lista = wynik uruchomienia reguły bez listy (Z3). Każda partia #193 usuwa
 *   swoje pozycje stąd i z BASELINE w teście; nowych pozycji nie dopisujemy
 *   (test zbioru Z4: lista ⊆ BASELINE).
 */

/** Ścieżka importu puli `db`: `@/lib/db` albo względna kończąca się na `/db`. */
export const DB_IMPORT_SOURCE_REGEX = "^(@/lib/db|(\\.{1,2}/)+(.*/)?db)(\\.[cm]?[jt]s)?$";

/** Ścieżka importu puli systemowej (dowolna forma kończąca się na `db-system`). */
export const DB_SYSTEM_IMPORT_SOURCE_REGEX = "(^|/)db-system(\\.[cm]?[jt]s)?$";

/** Sterownik/klient Postgresa — własny klient puli (wymaganie (1) do #206). */
export const DB_CLIENT_IMPORT_SOURCE_REGEX =
  "^(postgres|pg|drizzle-orm/(postgres-js|node-postgres|neon-[^/]+)|@neondatabase/serverless)(/.*)?$";

/** Plik testowy (`*.test.*`, `*.spec.*`) — testy w src/ są poza zakazem db, więc kod produkcyjny ich nie importuje (uwaga do #206). */
export const TEST_FILE_IMPORT_SOURCE_REGEX = "\\.(test|spec)(\\.[cm]?[jt]sx?)?$";

const DB_MESSAGE =
  "Surowy `db` omija izolację salonu (#193). Dane salonu: forSalon(salonId) z @/lib/server/repository; " +
  "wyjście systemowe: nazwana funkcja z @/lib/server/system/*.";

const DB_SYSTEM_MESSAGE =
  "Pula systemowa jest dostępna tylko w src/lib/server/system/** — wołaj nazwaną funkcję z @/lib/server/system/* (#193).";

const DB_CLIENT_MESSAGE =
  "Własny klient puli Postgresa tylko w src/lib/db.ts i src/lib/server/system/db-system.ts (#193). " +
  "Dane salonu: forSalon(salonId) z @/lib/server/repository; wyjście systemowe: nazwana funkcja z @/lib/server/system/*.";

const TEST_FILE_MESSAGE =
  "Kod produkcyjny nie importuje plików testowych (*.test.*, *.spec.*) — są poza zakazem db (#193).";

const DB_EXPORT_MESSAGE =
  "Plik z wyjątkiem dla `db` nie wystawia puli dalej (#193): bez eksportu wartości `db` (eksport typu dozwolony).";

/** Pliki objęte regułami izolacji. */
export const DB_ISOLATION_FILES = ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"];

/** Pliki testów w `src/` — poza regułą (testy jednostkowe mockują `db`). */
export const DB_ISOLATION_TEST_FILES = ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"];

/** Wyjątki stałe: warstwa, która z definicji trzyma pulę. */
export const DB_ISOLATION_PERMANENT = ["src/lib/server/repository.ts"];

/** Pula systemowa wolna tylko tu. */
export const DB_SYSTEM_ALLOWED_FILES = ["src/lib/server/system/**"];

/** Jedyne pliki, które tworzą klienta puli (`postgres` + `drizzle-orm/postgres-js`). */
export const DB_CLIENT_ALLOWED_FILES = ["src/lib/db.ts", "src/lib/server/system/db-system.ts"];

/** Plik puli systemowej (do P6 re-eksport `db`, jedyny plik system/** z prawem do `db`). */
const DB_SYSTEM_FILE = "src/lib/server/system/db-system.ts";

/**
 * Dług przejściowy (Z3) — wynik reguły bez listy (73 pliki na b3a5faf),
 * podzielony na tablice per partia #193 (P0a pkt 3).
 * Każda partia zmienia WYŁĄCZNIE swoją tablicę (np. P5: P5_FILES). Przeniesienie
 * pliku między tablicami = decyzja CTO + zmiana BASELINE w teście w
 * osobnym commicie. Przydział: zlecenie §0, §1, §3, §6; P5 wg osobnej listy;
 * session.ts → P0 i subscription.ts → P1 (decyzja CTO).
 */
/** P0b: ustalanie salonu z sesji (w tym requireAdmin), health/diagnostics, adapter Better Auth. */
export const P0_FILES = [];

/** P1a/b/c: płatności (zadatki, subskrypcje, webhook Stripe). */
export const P1_FILES = [
  "src/app/api/deposits/create-session/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/lib/deposit-confirmation.ts",
  "src/lib/refund.ts",
  "src/lib/subscription-confirmation.ts",
  "src/lib/subscription-locks.ts",
];

/** P2: ścieżka właściciela. */
export const P2_FILES = [
  "src/app/api/ai/content/newsletter/route.ts",
  "src/app/api/appointments/[id]/complete/route.ts",
  "src/app/api/appointments/[id]/invoice/route.ts",
  "src/app/api/clients/[id]/route.ts",
  "src/app/api/dashboard/stats/route.ts",
  "src/app/api/employees/[id]/link-account/route.ts",
  "src/app/api/temporary-access/route.ts",
  "src/lib/ai/business/chat.ts",
  "src/lib/ai/openrouter.ts",
  "src/lib/ai/usage-limits.ts",
];

/** P3: publiczna rezerwacja i katalog. */
export const P3_FILES = [];

/** P4: portal klienta (forUser). */
export const P4_FILES = [
  "src/app/api/client/appointments/[id]/cancel/route.ts",
  "src/app/api/client/appointments/[id]/review/route.ts",
  "src/app/api/client/appointments/[id]/route.ts",
  "src/app/api/client/appointments/route.ts",
  "src/app/api/client/reviews/route.ts",
  "src/app/api/client/waiting-list/[id]/route.ts",
  "src/app/api/client/waiting-list/route.ts",
  "src/app/api/favorites/salons/check/route.ts",
  "src/app/api/favorites/salons/route.ts",
  "src/app/api/push/subscribe/route.ts",
  "src/app/api/push/unsubscribe/route.ts",
  "src/app/api/salons/mine/route.ts",
];

/** P5: crony, powiadomienia, rejestracja triala, seed, plany, biblioteki powiadomień. */
export const P5_FILES = [
  "src/app/api/register-subscription/route.ts",
];

/** P6: przełączenie puli (dziś bez plików). */
export const P6_FILES = [];

/** Partie w kolejności; klucz = nazwa tablicy. */
export const DB_ISOLATION_PARTITIONS = { P0_FILES, P1_FILES, P2_FILES, P3_FILES, P4_FILES, P5_FILES, P6_FILES };

/** Suma zbiorów — dług przejściowy jako całość. */
export const DB_ISOLATION_TRANSITIONAL = Object.values(DB_ISOLATION_PARTITIONS).flat();

/** Dosłowna ścieżka → wzorzec minimatch (`[id]` w Next to klasa znaków w globie). */
export function literalGlob(path) {
  return path.replace(/[[\]*?{}()!+@]/g, (c) => `\\${c}`);
}

function restrictedSources({ db, dbSystem, client, testFile }) {
  const sources = [];
  if (db) sources.push([DB_IMPORT_SOURCE_REGEX, DB_MESSAGE]);
  if (dbSystem) sources.push([DB_SYSTEM_IMPORT_SOURCE_REGEX, DB_SYSTEM_MESSAGE]);
  if (client) sources.push([DB_CLIENT_IMPORT_SOURCE_REGEX, DB_CLIENT_MESSAGE]);
  if (testFile) sources.push([TEST_FILE_IMPORT_SOURCE_REGEX, TEST_FILE_MESSAGE]);
  return sources;
}

/** esquery: literał /…/ w selektorze nie może zawierać znaku „/” — zapis \x2F. */
const esq = (src) => src.replaceAll("/", "\\x2F");

/**
 * Wymaganie (2) do #206: plik z wyjątkiem dla `db` nie wystawia wartości
 * `db` dalej (re-eksport, eksport nazwany, `export const x = db`, `export default db`).
 * Eksport typu (`export type …`, `export type { … } from`) przechodzi.
 */
export function exportDbSelectors() {
  const re = esq(DB_IMPORT_SOURCE_REGEX);
  return [
    `ExportNamedDeclaration[exportKind!='type'][source.value=/${re}/]`,
    `ExportAllDeclaration[exportKind!='type'][source.value=/${re}/]`,
    "ExportNamedDeclaration[exportKind!='type'] > ExportSpecifier[exportKind!='type'][local.name='db']",
    "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.name='db']",
    "ExportDefaultDeclaration[declaration.name='db']",
  ].map((selector) => ({ selector, message: DB_EXPORT_MESSAGE }));
}

/** Opcje `no-restricted-imports` (statyczne importy, `import *`, re-eksporty). */
export function restrictedImportsOptions(which) {
  return { patterns: restrictedSources(which).map(([regex, message]) => ({ regex, message })) };
}

/**
 * Selektory `no-restricted-syntax` dla `import()` i `require()` z literałem albo
 * szablonem bez wyrażeń. TS `import x = require("…")` łapie sama reguła
 * `no-restricted-imports` (dowód w teście), więc osobnego selektora nie ma.
 */
export function isolationSyntaxSelectors(which) {
  const sources = restrictedSources(which);
  const out = [];
  for (const [src, message] of sources) {
    const re = esq(src);
    out.push(
      { selector: `ImportExpression[source.value=/${re}/]`, message },
      { selector: `ImportExpression > TemplateLiteral[expressions.length=0] > TemplateElement[value.raw=/${re}/]`, message },
      { selector: `CallExpression[callee.name='require'][arguments.0.value=/${re}/]`, message },
      {
        selector: `CallExpression[callee.name='require'] > TemplateLiteral.arguments[expressions.length=0] > TemplateElement[value.raw=/${re}/]`,
        message,
      },
    );
  }
  return out;
}

/** Reguły, na których opiera się izolacja (W1: nie wolno ich wyłączać komentarzem). */
export const DB_ISOLATION_RULES = ["no-restricted-imports", "no-restricted-syntax"];

/**
 * Obie reguły dla grupy plików. `no-restricted-syntax` w flat config NIE łączy
 * opcji między blokami (późniejszy blok zastępuje), więc selektory innych
 * zakazów (`otherSyntax`, np. D1) idą razem z selektorami izolacji.
 */
export function dbIsolationRules(which, otherSyntax = []) {
  const imports = restrictedImportsOptions(which);
  return {
    "no-restricted-imports": imports.patterns.length > 0 ? ["error", imports] : "off",
    "no-restricted-syntax": [
      "error",
      ...otherSyntax,
      ...isolationSyntaxSelectors(which),
      ...(which.exportDb ? exportDbSelectors() : []),
    ],
  };
}

/**
 * Bloki flat config. Kolejność ma znaczenie (późniejszy wygrywa):
 * 1. cały `src/` — zakaz `db`, `db-system`, własnego klienta puli i importu plików testowych;
 * 2. `server/system/**` — wolno `db-system`;
 * 3. wyjątki stałe i dług przejściowy — wolno `db`, ale bez wystawiania go
 *    dalej; nadal nie wolno `db-system` ani własnego klienta;
 * 4. `src/lib/db.ts` i `system/db-system.ts` — jedyne miejsca klienta puli;
 * 5. testy w `src/` — bez zakazów importu, ale z zakazem wystawiania `db` dalej.
 */
export function dbIsolationConfig(otherSyntax = []) {
  const blocks = [
    {
      files: DB_ISOLATION_FILES,
      rules: dbIsolationRules({ db: true, dbSystem: true, client: true, testFile: true }, otherSyntax),
    },
    {
      files: DB_SYSTEM_ALLOWED_FILES,
      rules: dbIsolationRules({ db: true, dbSystem: false, client: true, testFile: true }, otherSyntax),
    },
    {
      files: [...DB_ISOLATION_PERMANENT, ...DB_ISOLATION_TRANSITIONAL].map(literalGlob),
      rules: dbIsolationRules({ db: false, dbSystem: true, client: true, testFile: true, exportDb: true }, otherSyntax),
    },
    // P0b (decyzja z 16.11): do P6 `dbSystem` to re-eksport `db`, więc import `db`
    // wolno WYŁĄCZNIE dosłownemu plikowi db-system.ts (P6: z powrotem `db: true`).
    ...DB_CLIENT_ALLOWED_FILES.map((file) => ({
      files: [literalGlob(file)],
      rules: dbIsolationRules(
        {
          db: file !== DB_SYSTEM_FILE,
          dbSystem: !file.startsWith("src/lib/server/system/"),
          client: false,
          testFile: true,
        },
        otherSyntax,
      ),
    })),
    // Testy w src/ biorą db, ale nie wystawiają go kodowi produkcyjnemu (uwaga do #206).
    {
      files: DB_ISOLATION_TEST_FILES,
      rules: dbIsolationRules({ db: false, dbSystem: false, client: false, exportDb: true }, otherSyntax),
    },
  ];
  return blocks.filter((b) => b.files.length > 0);
}
