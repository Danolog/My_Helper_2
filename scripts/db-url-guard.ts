/**
 * Wspólna reguła parametrów zapytania w POSTGRES_URL dla skryptów, które łączą
 * się z bazą przez postgres.js, a potem oddają ten sam adres drizzle-kit
 * (`db:reset`, bramka `db:push`; #188, B2 Ethana i uwaga Leo do bramki push).
 *
 * Sterownik pg w drizzle-kit bierze host z `?host=` w zapytaniu, a postgres.js
 * ocenia host z części adresu przed ścieżką. Przy takim adresie bezpiecznik
 * mógłby sprawdzić bazę A, a drizzle-kit zmienić bazę B. Dlatego każdy parametr
 * zapytania spoza listy → odmowa; dozwolony tylko `sslmode`.
 *
 * Komunikaty podają same NAZWY parametrów, nigdy wartości ani adres.
 */

/** Jedyny parametr zapytania dopuszczony w POSTGRES_URL. */
export const DB_URL_ALLOWED_QUERY_PARAMS = ["sslmode"] as const;

/** Nazwy parametrów zapytania spoza listy (porównanie bez wielkości liter, bez wartości). */
export function disallowedQueryParams(url: string): string[] {
  const allowed = new Set<string>(DB_URL_ALLOWED_QUERY_PARAMS);
  const names = [...new URL(url).searchParams.keys()];
  return [...new Set(names.filter((n) => !allowed.has(n.toLowerCase())))];
}

/** Komunikat odmowy dla `subject` (np. "db:reset") albo `null`, gdy adres jest dopuszczalny. */
export function queryParamsRefusal(url: string, subject: string): string | null {
  const extra = disallowedQueryParams(url);
  if (extra.length === 0) return null;
  const shown = extra.map((n) => (/^[A-Za-z0-9_.-]{1,40}$/.test(n) ? n : "<nieprawidłowa nazwa>")).join(", ");
  return `${subject} odmawia: POSTGRES_URL ma parametry zapytania spoza listy (${shown}); dozwolony tylko ${DB_URL_ALLOWED_QUERY_PARAMS.join(", ")}`;
}
