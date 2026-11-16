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

const DB_MESSAGE =
  "Surowy `db` omija izolację salonu (#193). Dane salonu: forSalon(salonId) z @/lib/server/repository; " +
  "wyjście systemowe: nazwana funkcja z @/lib/server/system/*.";

const DB_SYSTEM_MESSAGE =
  "Pula systemowa jest dostępna tylko w src/lib/server/system/** — wołaj nazwaną funkcję z @/lib/server/system/* (#193).";

/** Pliki objęte regułami izolacji. */
export const DB_ISOLATION_FILES = ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"];

/** Pliki testów w `src/` — poza regułą (testy jednostkowe mockują `db`). */
export const DB_ISOLATION_TEST_FILES = ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"];

/** Wyjątki stałe: warstwa, która z definicji trzyma pulę. */
export const DB_ISOLATION_PERMANENT = ["src/lib/server/repository.ts"];

/** Pula systemowa wolna tylko tu. */
export const DB_SYSTEM_ALLOWED_FILES = ["src/lib/server/system/**"];

/** Dług przejściowy (Z3) — wynik reguły bez listy. Maleje z każdą partią. */
export const DB_ISOLATION_TRANSITIONAL = [
  "src/app/api/ai/content/newsletter/route.ts",
  "src/app/api/appointments/[id]/complete/route.ts",
  "src/app/api/appointments/[id]/invoice/route.ts",
  "src/app/api/appointments/[id]/route.ts",
  "src/app/api/appointments/route.ts",
  "src/app/api/available-slots/route.ts",
  "src/app/api/client/appointments/[id]/cancel/route.ts",
  "src/app/api/client/appointments/[id]/review/route.ts",
  "src/app/api/client/appointments/[id]/route.ts",
  "src/app/api/client/appointments/route.ts",
  "src/app/api/client/reviews/route.ts",
  "src/app/api/client/waiting-list/[id]/route.ts",
  "src/app/api/client/waiting-list/route.ts",
  "src/app/api/clients/[id]/loyalty/redeem/route.ts",
  "src/app/api/clients/[id]/route.ts",
  "src/app/api/cron/cleanup-pending-deposits/route.ts",
  "src/app/api/cron/push-reminders-24h/route.ts",
  "src/app/api/cron/push-reminders/route.ts",
  "src/app/api/cron/sms-reminders/route.ts",
  "src/app/api/dashboard/stats/route.ts",
  "src/app/api/deposits/create-session/route.ts",
  "src/app/api/diagnostics/route.ts",
  "src/app/api/employees/[id]/link-account/route.ts",
  "src/app/api/favorites/salons/check/route.ts",
  "src/app/api/favorites/salons/route.ts",
  "src/app/api/health/route.ts",
  "src/app/api/notifications/birthday/route.ts",
  "src/app/api/notifications/low-stock/route.ts",
  "src/app/api/notifications/we-miss-you/route.ts",
  "src/app/api/promotions/check-happy-hours/route.ts",
  "src/app/api/promotions/check-package/route.ts",
  "src/app/api/promotions/check/route.ts",
  "src/app/api/push/subscribe/route.ts",
  "src/app/api/push/unsubscribe/route.ts",
  "src/app/api/register-subscription/route.ts",
  "src/app/api/reminders/appointment/route.ts",
  "src/app/api/salons/[id]/employees/[employeeId]/route.ts",
  "src/app/api/salons/[id]/gallery/route.ts",
  "src/app/api/salons/[id]/route.ts",
  "src/app/api/salons/[id]/services/[serviceId]/route.ts",
  "src/app/api/salons/mine/route.ts",
  "src/app/api/salons/route.ts",
  "src/app/api/seed/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/app/api/subscription-plans/route.ts",
  "src/app/api/subscriptions/cancel/route.ts",
  "src/app/api/subscriptions/checkout/route.ts",
  "src/app/api/subscriptions/current/route.ts",
  "src/app/api/subscriptions/expiration-warning/route.ts",
  "src/app/api/subscriptions/payments/[id]/receipt/route.ts",
  "src/app/api/subscriptions/payments/route.ts",
  "src/app/api/subscriptions/renew/route.ts",
  "src/app/api/temporary-access/route.ts",
  "src/lib/ai/business/chat.ts",
  "src/lib/ai/openrouter.ts",
  "src/lib/ai/usage-limits.ts",
  "src/lib/auth.ts",
  "src/lib/deposit-calculation.ts",
  "src/lib/deposit-confirmation.ts",
  "src/lib/email.ts",
  "src/lib/get-user-salon.ts",
  "src/lib/notification-settings.ts",
  "src/lib/push.ts",
  "src/lib/refund.ts",
  "src/lib/salon-cancellation.ts",
  "src/lib/salon-context.ts",
  "src/lib/session.ts",
  "src/lib/sms.ts",
  "src/lib/subscription-confirmation.ts",
  "src/lib/subscription-locks.ts",
  "src/lib/subscription.ts",
  "src/lib/temporary-access.ts",
  "src/lib/waiting-list.ts",
];

/** Dosłowna ścieżka → wzorzec minimatch (`[id]` w Next to klasa znaków w globie). */
export function literalGlob(path) {
  return path.replace(/[[\]*?{}()!+@]/g, (c) => `\\${c}`);
}

function restrictedSources({ db, dbSystem }) {
  const sources = [];
  if (db) sources.push([DB_IMPORT_SOURCE_REGEX, DB_MESSAGE]);
  if (dbSystem) sources.push([DB_SYSTEM_IMPORT_SOURCE_REGEX, DB_SYSTEM_MESSAGE]);
  return sources;
}

/** Opcje `no-restricted-imports` (statyczne importy, `import *`, re-eksporty). */
export function restrictedImportsOptions(which) {
  return { patterns: restrictedSources(which).map(([regex, message]) => ({ regex, message })) };
}

/** Selektory `no-restricted-syntax` dla `import()` i `require()` z literałem albo szablonem bez wyrażeń. */
export function isolationSyntaxSelectors(which) {
  const sources = restrictedSources(which);
  const out = [];
  for (const [src, message] of sources) {
    // esquery: literał /…/ w selektorze nie może zawierać znaku „/” — zapis \x2F.
    const re = src.replaceAll("/", "\\x2F");
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
    "no-restricted-syntax": ["error", ...otherSyntax, ...isolationSyntaxSelectors(which)],
  };
}

/**
 * Bloki flat config. Kolejność ma znaczenie (późniejszy wygrywa):
 * 1. cały `src/` — zakaz `db` i `db-system`;
 * 2. `server/system/**` — wolno `db-system`;
 * 3. wyjątki stałe i dług przejściowy — wolno `db`, nadal nie wolno `db-system`;
 * 4. testy w `src/` — bez zakazów izolacji (same `otherSyntax`).
 */
export function dbIsolationConfig(otherSyntax = []) {
  const blocks = [
    { files: DB_ISOLATION_FILES, rules: dbIsolationRules({ db: true, dbSystem: true }, otherSyntax) },
    { files: DB_SYSTEM_ALLOWED_FILES, rules: dbIsolationRules({ db: true, dbSystem: false }, otherSyntax) },
    {
      files: [...DB_ISOLATION_PERMANENT, ...DB_ISOLATION_TRANSITIONAL].map(literalGlob),
      rules: dbIsolationRules({ db: false, dbSystem: true }, otherSyntax),
    },
    { files: DB_ISOLATION_TEST_FILES, rules: dbIsolationRules({ db: false, dbSystem: false }, otherSyntax) },
  ];
  return blocks.filter((b) => b.files.length > 0);
}
